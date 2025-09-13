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

export async function onRequest(context) {
    const { request, env, params } = context;

    // 获取 URL 中的短 ID，它应该包含文件扩展名
    const shortFilenameWithExtension = params.id;

    if (!shortFilenameWithExtension) {
        return new Response('File not found', { status: 404 });
    }

    try {
        // 使用短文件名作为键，从 KV 获取元数据
        const { metadata } = await env.img_url.getWithMetadata(shortFilenameWithExtension);

        // 检查元数据是否存在，并且其中包含了原始 Telegram 文件名
        if (metadata && metadata.fileName) {
            // 从元数据中提取原始 Telegram 文件 ID
            const telegramFileId = metadata.fileName.split('.')[0];
            const filePath = await getFilePath(env, telegramFileId);

            if (filePath) {
                const fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
                
                // 向 Telegram 发送请求，获取图片内容并直接返回给用户
                const response = await fetch(fileUrl, {
                    method: request.method,
                    headers: request.headers,
                    body: request.body,
                });
                return response;
            }
        }
    } catch (e) {
        console.error("Error during shortlink lookup or file fetch:", e);
    }

    // 如果以上任何步骤失败，都返回 404
    return new Response('File not found', { status: 404 });
}
