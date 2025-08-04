// 辅助函数：通过 Telegram 的 file_id 获取文件路径
async function getFilePath(env, file_id) {
    console.log(`Debug: getFilePath called with file_id: ${file_id}`);
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, { method: 'GET' });

        if (!res.ok) {
            console.error(`Debug: HTTP error fetching file path: ${res.status}`);
            return null;
        }

        const responseData = await res.json();
        if (responseData.ok && responseData.result) {
            console.log(`Debug: File path received: ${responseData.result.file_path}`);
            return responseData.result.file_path;
        }
        console.error('Debug: Error in Telegram getFile response data:', responseData);
        return null;
    } catch (error) {
        console.error('Debug: Error in getFilePath:', error.message);
        return null;
    }
}

export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    
    console.log(`Debug: Incoming URL: ${url.href}`);
    console.log(`Debug: params.id: ${params.id}`);

    let fileUrl = null;
    let originalFileId = null;

    if (params.id) {
        // --- 1. 短链接处理 ---
        console.log("Debug: Processing as short link.");
        if (!env.img_url) {
            console.error("Debug: KV binding 'img_url' is missing.");
            return new Response('KV binding is missing.', { status: 500 });
        }
        
        try {
            const { metadata } = await env.img_url.getWithMetadata(params.id, { type: 'text' });
            if (metadata && metadata.fileName) {
                originalFileId = metadata.fileName.split('.')[0];
                console.log(`Debug: Found original file ID in KV: ${originalFileId}`);
            } else {
                console.warn("Debug: Short link not found in KV metadata.");
            }
        } catch (error) {
            console.error(`Debug: Error fetching from KV: ${error.message}`);
        }
    } else {
        // --- 2. 长链接处理 ---
        console.log("Debug: Processing as long link.");
        const pathParts = url.pathname.split('/');
        const filename = pathParts.pop();
        if (filename && filename.length > 39) {
            originalFileId = filename.split('.')[0];
            console.log(`Debug: Extracted long file ID from URL: ${originalFileId}`);
        }
    }

    if (originalFileId) {
        const filePath = await getFilePath(env, originalFileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            console.log(`Debug: Final Telegram file URL: ${fileUrl}`);
        }
    } else {
        fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
        console.log(`Debug: Final Telegra.ph file URL: ${fileUrl}`);
    }

    if (!fileUrl) {
        console.error("Debug: Failed to determine file URL.");
        return new Response('File not found.', { status: 404 });
    }

    // --- 3. 下载文件并返回 ---
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });
    
    console.log(`Debug: Final fetch response status: ${response.status}`);

    // 如果 fetch 失败，直接返回错误响应
    if (!response.ok) {
        return response;
    }

    // 克隆响应，以便修改响应头
    const newResponse = new Response(response.body, response);
    
    // --- 关键改动：主动设置响应头 ---
    // 强制 Content-Disposition 为 inline，使其在浏览器中显示
    newResponse.headers.set('Content-Disposition', 'inline');

    // 移除 Content-Type 中的 charset 信息，以避免潜在的渲染问题
    const contentType = newResponse.headers.get('Content-Type');
    if (contentType) {
        newResponse.headers.set('Content-Type', contentType.split(';')[0]);
    }

    return newResponse;
}
