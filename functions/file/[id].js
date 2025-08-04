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

    // --- 首先尝试处理短链接和元数据 ---
    let metadata = {};
    if (env.img_url) {
        const { metadata: storedMetadata } = await env.img_url.getWithMetadata(shortFilename, { type: 'text' });
        if (storedMetadata) {
            metadata = storedMetadata;
        } else {
            // 如果元数据不存在，则初始化
            metadata = {
                ListType: "None",
                Label: "None",
                TimeStamp: Date.now(),
                liked: false,
                fileName: shortFilename,
                fileSize: 0,
            };
            await env.img_url.put(shortFilename, "", { metadata });
        }
    }

    // 根据元数据中的文件名来决定文件ID
    if (metadata.fileName && metadata.fileName !== shortFilename) {
        // 如果元数据中的文件名是原始长文件名
        originalFileId = metadata.fileName.split('.')[0];
    } else if (shortFilename.length > 39) {
        // 如果短文件名本身就是长文件ID（旧的逻辑）
        originalFileId = shortFilename.split('.')[0];
    }

    // --- 根据文件ID构建最终的下载链接 ---
    if (originalFileId) {
        const filePath = await getFilePath(env, originalFileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        } else {
            return new Response('File not found in Telegram.', { status: 404 });
        }
    } else {
        // 如果不是 Telegram 文件，回退到 Telegra.ph 的链接
        fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
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

    // --- 应用所有过滤和重定向逻辑 ---
    
    // 如果 KV 存储不可用，直接返回
    if (!env.img_url) {
        console.log("KV storage not available, returning image directly");
        return response;
    }

    // 处理 ListType 和 Label
    if (metadata.ListType === "White") {
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // 检查白名单模式
    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // 内容审核逻辑
    if (env.ModerateContentApiKey) {
        try {
            console.log("Starting content moderation...");
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=${fileUrl}`;
            const moderateResponse = await fetch(moderateUrl);

            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;
                    if (moderateData.rating_label === "adult") {
                        await env.img_url.put(shortFilename, "", { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            } else {
                console.error("Content moderation API request failed: " + moderateResponse.status);
            }
        } catch (error) {
            console.error("Error during content moderation: " + error.message);
        }
    }

    // 保存更新后的元数据
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
