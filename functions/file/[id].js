export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;
    
    const url = new URL(request.url);

    // 从 URL 中获取短文件名
    const shortFilename = params.id;
    
    // 如果没有短文件名，返回 404
    if (!shortFilename) {
        return new Response('File not found.', { status: 404 });
    }

    // 从 KV 存储中获取元数据
    const { metadata } = await env.img_url.getWithMetadata(shortFilename, { type: 'text' });
    
    // 如果 KV 存储中没有记录或元数据不完整，返回 404
    if (!metadata || !metadata.fileName) {
        return new Response('File not found in KV.', { status: 404 });
    }

    // 从元数据中提取原始的 Telegram 文件 ID
    const originalFilename = metadata.fileName;
    const originalFileId = originalFilename.split('.')[0];

    // 使用原始的 fileId 去获取 Telegram 的文件路径
    const filePath = await getFilePath(env, originalFileId);
    if (!filePath) {
        return new Response('Failed to get file path from Telegram.', { status: 500 });
    }

    const fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;

    // 下载文件并直接返回给用户
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) {
        console.error("Failed to fetch image from Telegram:", response.status);
        return new Response('Failed to fetch image from Telegram.', { status: 500 });
    }
    
    // 返回文件内容
    return new Response(response.body, {
        status: response.status,
        headers: response.headers,
    });
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
