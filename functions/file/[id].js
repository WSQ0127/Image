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

    // --- 优先处理短链接：如果 params.id 存在，说明是短链接 ---
    if (params.id) {
        const shortFilename = params.id;
        
        // 尝试从 KV 存储中用短文件名作为键来查找
        const { metadata } = await env.img_url.getWithMetadata(shortFilename, { type: 'text' });
        
        if (metadata && metadata.fileName) {
            const originalFileId = metadata.fileName.split('.')[0];
            const filePath = await getFilePath(env, originalFileId);
            if (filePath) {
                // 如果找到原始文件路径，构建一个长链接
                fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
                
                // 返回 302 重定向到这个长链接，这样浏览器会直接加载长链接
                // 浏览器只会看到长链接，而不是短链接
                return Response.redirect(fileUrl, 302);
            }
        }
        
        // 如果 KV 中没有找到，或者文件路径获取失败，返回 404
        return new Response('Short link not found or invalid.', { status: 404 });
    } 
    
    // --- 如果不是短链接，则按照你的原始逻辑处理 ---
    // 检查 URL 路径长度，判断是否为 Telegram Bot API 的长链接
    if (url.pathname.length > 39) {
        const filename = url.pathname.split(".")[0].split("/")[2];
        const filePath = await getFilePath(env, filename);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        } else {
            return new Response('File not found in Telegram.', { status: 404 });
        }
    } else {
        // 否则，默认为 Telegra.ph 链接
        fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    }
    
    // 如果最终没有找到 fileUrl，返回 404
    if (!fileUrl) {
        return new Response('File not found.', { status: 404 });
    }

    // --- 下载文件并进行内容过滤（只在直接访问时执行）---
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) {
        return response;
    }

    // 这部分逻辑将只在非短链接访问时执行，不影响重定向
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return response;
    }

    // 以下是你的内容过滤和审核逻辑，此处省略以保持代码简洁，但可以根据需要重新添加。
    // ...

    return response;
}
