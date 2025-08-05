async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
            return null;
        }
        const responseData = await res.json();
        if (responseData.ok && responseData.result) {
            return responseData.result.file_path;
        }
        return null;
    } catch (error) {
        return null;
    }
}

export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);

    let fileUrl = null;
    let originalFileId = null;

    if (params.id) {
        if (!env.img_url) {
            return new Response('Error', { status: 500 });
        }
        
        try {
            const { metadata } = await env.img_url.getWithMetadata(params.id, { type: 'text' });
            if (metadata && metadata.fileName) {
                originalFileId = metadata.fileName.split('.')[0];
            }
        }
        catch (error) {
            console.error('Error', error);
            return new Response('Error', { status: 500 });
        }
    }
    else {
        const pathParts = url.pathname.split('/');
        const filename = pathParts.pop();
        if (filename && filename.length > 39) {
            originalFileId = filename.split('.')[0];
        }
    }

    if (originalFileId) {
        const filePath = await getFilePath(env, originalFileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }
    else {
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
    
    return response;
}
