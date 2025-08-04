// 这是一个辅助函数，可以安全地从不同格式的 URL 中获取文件名
function getFilenameFromUrl(params, url) {
    if (params.id) {
        return params.id;
    }
    // 回退到从 URL 路径中手动解析文件名，以支持旧的长链接
    const pathParts = url.pathname.split('/');
    if (pathParts.length > 2 && pathParts[1] === 'file') {
        return pathParts.pop();
    }
    return null;
}

export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    const shortFilename = getFilenameFromUrl(params, url);
    let originalFileId = null;
    let fileUrl = null;

    if (!shortFilename) {
        return new Response('File not found.', { status: 404 });
    }

    // --- NEW LOGIC: 首先尝试处理短链接 ---
    // 从 KV 存储中根据短文件名获取元数据
    const { metadata } = await env.img_url.getWithMetadata(shortFilename, { type: 'text' });
    if (metadata && metadata.fileName) {
        // 从元数据中提取原始的长 Telegram 文件ID
        originalFileId = metadata.fileName.split('.')[0];
    }
    
    // --- ORIGINAL LOGIC: 如果没有短链接，则回退到原始的长链接逻辑 ---
    if (originalFileId) {
        const filePath = await getFilePath(env, originalFileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        } else {
            return new Response('File not found in Telegram.', { status: 404 });
        }
    } else {
        if (shortFilename.length > 39) {
            const filePath = await getFilePath(env, shortFilename.split(".")[0]);
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        } else {
            fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
        }
    }

    if (!fileUrl) {
        return new Response('File not found.', { status: 404 });
    }

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    console.log(response.ok, response.status);

    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return response;
    }

    if (!env.img_url) {
        console.log("KV storage not available, returning image directly");
        return response;
    }

    let record = await env.img_url.getWithMetadata(shortFilename);
    let currentMetadata = record && record.metadata ? record.metadata : {};

    if (!record || !record.metadata) {
        console.log("Metadata not found, initializing...");
        currentMetadata = {
            ListType: "None",
            Label: "None",
            TimeStamp: Date.now(),
            liked: false,
            fileName: shortFilename, 
            fileSize: 0,
        };
        await env.img_url.put(shortFilename, "", { metadata: currentMetadata });
    }

    const metadata = {
        ListType: currentMetadata.ListType || "None",
        Label: currentMetadata.Label || "None",
        TimeStamp: currentMetadata.TimeStamp || Date.now(),
        liked: currentMetadata.liked !== undefined ? currentMetadata.liked : false,
        fileName: currentMetadata.fileName || shortFilename,
        fileSize: currentMetadata.fileSize || 0,
    };

    if (metadata.ListType === "White") {
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    if (env.ModerateContentApiKey) {
        try {
            console.log("Starting content moderation...");
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);

            if (!moderateResponse.ok) {
                console.error("Content moderation API request failed: " + moderateResponse.status);
            } else {
                const moderateData = await moderateResponse.json();

                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;

                    if (moderateData.rating_label === "adult") {
                        console.log("Content marked as adult, saving metadata and redirecting");
                        await env.img_url.put(shortFilename, "", { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            }
        } catch (error) {
            console.error("Error during content moderation: " + error.message);
        }
    }

    console.log("Saving metadata");
    await env.img_url.put(shortFilename, "", { metadata });

    return response;
}

// 辅助函数：通过 Telegram 的 file_id 获取文件路径
async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, {
            method: 'GET',
        });

        if (!res.ok) {
            console.error(`HTTP error! status: ${res.status}`);
            return null;
        }

        const responseData = await res.json();
        const { ok, result } = responseData;

        if (ok && result) {
            return result.file_path;
        } else {
            console.error('Error in response data:', responseData);
            return null;
        }
    } catch (error) {
        console.error('Error fetching file path:', error.message);
        return null;
    }
}
