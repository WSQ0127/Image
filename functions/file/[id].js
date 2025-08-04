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
    let filename = null;
    let isShortLink = false;

    // --- 第一步：确定链接类型并获取文件名 ---
    if (params.id) {
        // 这是短链接
        filename = params.id;
        isShortLink = true;
    } else {
        // 这是长链接
        filename = url.pathname.split('/').pop();
    }
    
    if (!filename) {
        return new Response('File not found.', { status: 404 });
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
        }
    } else {
        // 处理长链接：直接从文件名中提取文件ID
        if (filename.length > 39) {
            const fileId = filename.split('.')[0];
            const filePath = await getFilePath(env, fileId);
            if (filePath) {
                fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            }
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

    // --- 第三步：下载文件并进行内容过滤 ---
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) {
        return response;
    }

    // 元数据和过滤逻辑只在短链接且 KV 可用时执行
    if (isShortLink && env.img_url) {
        let metadata = {
            ListType: "None",
            Label: "None",
            TimeStamp: Date.now(),
            liked: false,
            fileName: filename,
            fileSize: 0,
        };

        const record = await env.img_url.getWithMetadata(filename);
        if (record && record.metadata) {
            metadata = record.metadata;
        } else {
            await env.img_url.put(filename, "", { metadata });
        }

        // 管理员直接访问
        const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
        if (isAdmin) {
            return response;
        }

        // 处理白名单和黑名单
        if (metadata.ListType === "White") return response;
        if (metadata.ListType === "Block" || metadata.Label === "adult") {
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
