export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);

    let fileUrl = null;
    let filename = null;

    // 获取文件名：优先从动态路由 params.id 获取，否则从 URL 路径中获取
    if (params.id) {
        filename = params.id;
    } else {
        const pathParts = url.pathname.split('/');
        filename = pathParts.pop();
    }

    // 如果文件名为空，直接返回 404
    if (!filename) {
        return new Response('File not found.', { status: 404 });
    }

    // 处理短链接：从 KV 存储中查找原始文件名
    const { metadata } = await env.img_url.getWithMetadata(filename, { type: 'text' });
    if (metadata && metadata.fileName) {
        const originalFileId = metadata.fileName.split('.')[0];
        const filePath = await getFilePath(env, originalFileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }

    // 如果 fileUrl 仍然为空，说明不是短链接，尝试按照原始逻辑处理
    if (!fileUrl) {
        // 处理 Telegram Bot API 的长链接
        if (filename.length > 39) {
            const fileId = filename.split('.')[0];
            const filePath = await getFilePath(env, fileId);
            if (filePath) {
                fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            }
        } else {
            // 如果不是长链接，则默认为 Telegra.ph 的链接
            fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
        }
    }

    // 如果最终还是没有找到文件 URL，返回 404
    if (!fileUrl) {
        return new Response('File not found.', { status: 404 });
    }

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) {
        return response;
    }

    // --- 元数据和过滤逻辑 ---
    // 这部分逻辑只在文件名为短链接时运行，以避免影响旧的长链接
    if (params.id && env.img_url) {
        let record = await env.img_url.getWithMetadata(filename);
        let currentMetadata = record && record.metadata ? record.metadata : {
            ListType: "None",
            Label: "None",
            TimeStamp: Date.now(),
            liked: false,
            fileName: filename,
            fileSize: 0,
        };

        if (!record) {
            await env.img_url.put(filename, "", { metadata: currentMetadata });
        }

        const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
        if (isAdmin) {
            return response;
        }

        if (currentMetadata.ListType === "White") {
            return response;
        } else if (currentMetadata.ListType === "Block" || currentMetadata.Label === "adult") {
            const referer = request.headers.get('Referer');
            const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
            return Response.redirect(redirectUrl, 302);
        }

        if (env.WhiteList_Mode === "true") {
            return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
        }
        
        if (env.ModerateContentApiKey && !currentMetadata.Label) {
            try {
                const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=${fileUrl}`;
                const moderateResponse = await fetch(moderateUrl);
                if (moderateResponse.ok) {
                    const moderateData = await moderateResponse.json();
                    if (moderateData && moderateData.rating_label) {
                        currentMetadata.Label = moderateData.rating_label;
                        if (currentMetadata.Label === "adult") {
                            await env.img_url.put(filename, "", { metadata: currentMetadata });
                            return Response.redirect(`${url.origin}/block-img.html`, 302);
                        }
                    }
                }
            } catch (error) {
                console.error("Error during content moderation: " + error.message);
            }
        }
        await env.img_url.put(filename, "", { metadata: currentMetadata });
    }

    return response;
}

// 辅助函数：通过 Telegram 的 file_id 获取文件路径
async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
            console.error(`HTTP error! status: ${res.status}`);
            return null;
        }
        const responseData = await res.json();
        if (responseData.ok && responseData.result) {
            return responseData.result.file_path;
        }
        return null;
    } catch (error) {
        console.error('Error fetching file path:', error.message);
        return null;
    }
}
