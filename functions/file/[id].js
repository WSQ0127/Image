export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);

    let fileUrl = null;
    let filename = null;
    let isShortLink = false;

    // --- 第一步：确定链接类型并获取文件名/文件ID ---
    if (params.id) {
        // 这是短链接，从 params.id 获取文件名
        filename = params.id;
        isShortLink = true;
    } else {
        // 这是长链接，可能是 Telegram Bot API 或 Telegra.ph
        filename = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
    }
    
    // --- 第二步：根据文件名获取最终文件URL ---
    if (isShortLink && env.img_url) {
        // 处理短链接：从 KV 存储中查找原始文件名
        const { metadata } = await env.img_url.getWithMetadata(filename, { type: 'text' });
        if (metadata && metadata.fileName) {
            const originalFileId = metadata.fileName.split('.')[0];
            const filePath = await getFilePath(env, originalFileId);
            if (filePath) {
                fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            }
        } else {
            // 如果 KV 中没有找到，返回 404
            return new Response('File not found in KV store.', { status: 404 });
        }
    } else if (filename && filename.length > 39) {
        // 处理 Telegram Bot API 的长链接
        const fileId = filename.split('.')[0];
        const filePath = await getFilePath(env, fileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }

    // 如果以上都没有匹配，默认为 Telegra.ph 的链接
    if (!fileUrl) {
        fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    }
    
    // 如果最终还是没有找到文件 URL，返回 404
    if (!fileUrl) {
        return new Response('File not found.', { status: 404 });
    }

    // --- 第三步：下载文件并进行内容过滤（仅限短链接）---
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) {
        return response;
    }

    // 如果是短链接，才执行元数据和内容过滤逻辑
    if (isShortLink && env.img_url) {
        // 获取或初始化元数据
        let record = await env.img_url.getWithMetadata(filename);
        let metadata = record && record.metadata ? record.metadata : {
            ListType: "None",
            Label: "None",
            TimeStamp: Date.now(),
            liked: false,
            fileName: filename,
            fileSize: 0,
        };

        if (!record) {
            await env.img_url.put(filename, "", { metadata });
        }

        // 管理员直接访问
        const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
        if (isAdmin) {
            return response;
        }

        // 处理白名单和黑名单
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
        
        // 内容审核
        if (env.ModerateContentApiKey && !metadata.Label) {
            try {
                const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=${fileUrl}`;
                const moderateResponse = await fetch(moderateUrl);
                if (moderateResponse.ok) {
                    const moderateData = await moderateResponse.json();
                    if (moderateData && moderateData.rating_label) {
                        metadata.Label = moderateData.rating_label;
                        if (metadata.Label === "adult") {
                            await env.img_url.put(filename, "", { metadata });
                            return Response.redirect(`${url.origin}/block-img.html`, 302);
                        }
                    }
                }
            } catch (error) {
                console.error("Error during content moderation: " + error.message);
            }
        }
        await env.img_url.put(filename, "", { metadata });
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
