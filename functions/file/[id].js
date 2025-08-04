// 辅助函数：通过 Telegram 的 file_id 获取文件路径
async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, { method: 'GET' });
        
        if (!res.ok) {
            console.error(`HTTP error fetching file path: ${res.status}`);
            return null;
        }
        
        const responseData = await res.json();
        if (responseData.ok && responseData.result) {
            return responseData.result.file_path;
        }
        console.error('Error in response data from Telegram getFile:', responseData);
        return null;
    } catch (error) {
        console.error('Error fetching file path:', error.message);
        return null;
    }
}

export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);

    let fileUrl = null;
    let filename = params.id || url.pathname.split('/').pop();

    if (!filename) {
        return new Response('File not found.', { status: 404 });
    }

    // 尝试从 KV 存储中获取元数据
    let metadata = null;
    try {
        const record = await env.img_url.getWithMetadata(filename, { type: 'text' });
        if (record && record.metadata) {
            metadata = record.metadata;
        }
    } catch (error) {
        console.error("Error fetching metadata from KV:", error.message);
        // 如果 KV 存储出错，继续执行，不直接崩溃
    }

    // 根据 metadata 中的文件名或当前 URL 路径构建 file_id
    let fileIdToFetch = null;
    if (metadata && metadata.fileName) {
        fileIdToFetch = metadata.fileName.split('.')[0];
    } else if (filename.length > 39) {
        // 这是长链接，直接从文件名中提取 file_id
        fileIdToFetch = filename.split('.')[0];
    }

    // 构建文件 URL
    if (fileIdToFetch) {
        const filePath = await getFilePath(env, fileIdToFetch);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }

    // 如果以上都失败，回退到 Telegra.ph 链接
    if (!fileUrl) {
        fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    }
    
    // 如果最终还是没有找到文件 URL，返回 404
    if (!fileUrl) {
        return new Response('File not found.', { status: 404 });
    }

    // --- 文件下载和过滤逻辑 ---
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) {
        return response;
    }

    // 只有在是短链接且 KV 可用时才执行元数据相关逻辑
    if (params.id && env.img_url) {
        // 如果元数据为空，则初始化
        if (!metadata) {
            metadata = {
                ListType: "None",
                Label: "None",
                TimeStamp: Date.now(),
                liked: false,
                fileName: filename,
                fileSize: 0,
            };
            await env.img_url.put(filename, "", { metadata });
        }

        // --- 过滤和重定向逻辑 ---
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
