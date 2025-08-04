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
    let filename = params.id;

    // 如果是短链接请求
    if (filename) {
        const { metadata } = await env.img_url.getWithMetadata(filename, { type: 'text' });
        if (metadata && metadata.fileName) {
            const originalFileId = metadata.fileName.split('.')[0];
            const filePath = await getFilePath(env, originalFileId);
            if (filePath) {
                fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            }
        }
    } else {
        // 如果不是短链接，尝试按原始长链接处理
        const pathParts = url.pathname.split('/');
        const lastPart = pathParts.pop();

        if (lastPart && lastPart.length > 39) {
            const fileId = lastPart.split('.')[0];
            const filePath = await getFilePath(env, fileId);
            if (filePath) {
                fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            }
        } else {
            fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
        }
    }

    if (!fileUrl) {
        return new Response('File not found.', { status: 404 });
    }

    // 下载文件并返回
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) {
        return response;
    }

    // --- 元数据和过滤逻辑 ---
    // 这部分只在短链接存在时才执行
    if (filename && env.img_url) {
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

        const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
        if (isAdmin) {
            return response;
        }
        
        if (metadata.ListType === "White") return response;
        if (metadata.ListType === "Block" || metadata.Label === "adult") {
            const redirectUrl = `https://static-res.pages.dev/teleimage/img-block-compressed.png`;
            return Response.redirect(redirectUrl, 302);
        }
        if (env.WhiteList_Mode === "true") {
            return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
        }
        
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
