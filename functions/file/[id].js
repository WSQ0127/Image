export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);

    let fileUrl = null;
    let originalFileId = null;
    let shortFilename = null;

    // 优先处理短链接。如果 params.id 存在，说明是通过短链接访问的
    if (params.id) {
        shortFilename = params.id;
        // 尝试从 KV 存储中获取元数据
        const { metadata } = await env.img_url.getWithMetadata(shortFilename, { type: 'text' });
        if (metadata && metadata.fileName) {
            originalFileId = metadata.fileName.split('.')[0];
        }
    }

    // 如果 shortFilename 不存在，说明可能是旧的长链接或 Telegra.ph 链接
    if (!shortFilename) {
        const pathParts = url.pathname.split('/');
        if (pathParts.length > 2 && pathParts[1] === 'file') {
            const potentialFileId = pathParts.pop().split('.')[0];
            // 检查路径长度，判断是否为 Telegram Bot API 的长链接
            if (potentialFileId.length > 39) {
                originalFileId = potentialFileId;
            }
        }
    }

    // 根据找到的 file_id 构建最终的下载链接
    if (originalFileId) {
        const filePath = await getFilePath(env, originalFileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        } else {
            return new Response('File not found in Telegram.', { status: 404 });
        }
    } else {
        // 如果都不是，则默认为 Telegra.ph 链接
        fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    }
    
    if (!fileUrl) {
        return new Response('File not found.', { status: 404 });
    }

    // 开始下载文件并返回
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    // --- 元数据和过滤逻辑（与短链接/长链接无关，统一处理） ---
    if (!env.img_url || !shortFilename) {
        return response; // 如果没有 KV 存储或不是短链接，直接返回
    }

    let record = await env.img_url.getWithMetadata(shortFilename);
    let metadata = record && record.metadata ? record.metadata : {
        ListType: "None",
        Label: "None",
        TimeStamp: Date.now(),
        liked: false,
        fileName: shortFilename,
        fileSize: 0,
    };

    if (!record) {
        await env.img_url.put(shortFilename, "", { metadata });
    }

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
    
    // 内容审核
    if (env.ModerateContentApiKey && !metadata.Label) {
        try {
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
            }
        } catch (error) {
            console.error("Error during content moderation: " + error.message);
        }
    }

    await env.img_url.put(shortFilename, "", { metadata });

    return response;
}

// 辅助函数：通过 Telegram 的 file_id 获取文件路径
async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;

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
