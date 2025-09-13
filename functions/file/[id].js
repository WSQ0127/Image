// 辅助函数：通过 Telegram 的 file_id 获取文件路径
async function getFilePath(env, file_id) {
    console.log(`[getFilePath] file_id = ${file_id}`);
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        console.log(`[getFilePath] calling Telegram getFile API: ${url}`);
        const res = await fetch(url, {
            method: 'GET',
        });

        console.log(`[getFilePath] response status = ${res.status}`);
        if (!res.ok) {
            console.error(`[getFilePath] HTTP error! status: ${res.status}`);
            return null;
        }

        const responseData = await res.json();
        console.log(`[getFilePath] responseData = ${JSON.stringify(responseData)}`);
        const { ok, result } = responseData;

        if (ok && result) {
            console.log(`[getFilePath] got result.file_path = ${result.file_path}`);
            return result.file_path;
        } else {
            console.error('[getFilePath] Error in response data:', responseData);
            return null;
        }
    }
    catch (error) {
        console.error('[getFilePath] Error fetching file path:', error.message);
        return null;
    }
}

export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    console.log(`[onRequest] request.url = ${request.url}`);
    console.log(`[onRequest] params.id = ${params.id}`);

    const url = new URL(request.url);
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    let fileIdFromPath = null;
    let filenameToUse = null;

    if (params.id) {
        // 短链接逻辑
        filenameToUse = params.id;
        console.log(`[onRequest] short link detected. filenameToUse = ${filenameToUse}`);
        if (env.img_url) {
            try {
                const { metadata } = await env.img_url.getWithMetadata(params.id);
                console.log(`[onRequest] KV metadata for ${params.id} = ${JSON.stringify(metadata)}`);
                if (metadata && metadata.fileName) {
                    fileIdFromPath = metadata.fileName.split('.')[0];
                    console.log(`[onRequest] from metadata, fileIdFromPath = ${fileIdFromPath}`);
                }
            } catch (e) {
                console.error("[onRequest] Error fetching short link from KV:", e.message);
            }
        }
    } else {
        // 原始长链接逻辑
        const pathParts = url.pathname.split('/');
        const tempFilename = pathParts.pop();
        console.log(`[onRequest] long link detected. tempFilename = ${tempFilename}`);
        if (tempFilename) {
            // 改：不硬性要求长度 > 39
            // if (tempFilename.length > 39) {
                fileIdFromPath = tempFilename.split('.')[0];
                filenameToUse = tempFilename;
                console.log(`[onRequest] parsed fileIdFromPath = ${fileIdFromPath}, filenameToUse = ${filenameToUse}`);
            // }
        }
    }

    if (fileIdFromPath) {
        const filePath = await getFilePath(env, fileIdFromPath);
        console.log(`[onRequest] getFilePath returned = ${filePath}`);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            console.log(`[onRequest] updated fileUrl to Telegram file endpoint = ${fileUrl}`);
        } else {
            console.warn('[onRequest] filePath null, will use default fileUrl =', fileUrl);
        }
    } else {
        console.warn('[onRequest] fileIdFromPath is null, skipping Telegram file path logic.');
    }

    // 发出请求拿文件
    let response;
    try {
        console.log(`[onRequest] fetching fileUrl = ${fileUrl}`);
        response = await fetch(fileUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body,
        });
        console.log(`[onRequest] fetch status = ${response.status}`);
    } catch (fetchError) {
        console.error('[onRequest] Error fetching fileUrl:', fetchError.message);
        return new Response('Internal fetch error', { status: 500 });
    }

    if (!response.ok) {
        console.error(`[onRequest] Response not OK, status = ${response.status}`);
        return response;
    }

    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    console.log(`[onRequest] isAdmin? = ${isAdmin}`);

    if (isAdmin) {
        console.log('[onRequest] admin access, returning original response.');
        return response;
    }

    if (!env.img_url || !filenameToUse) {
        console.log('[onRequest] No KV binding or no filenameToUse, returning response without extra handling.');
        return response;
    }

    console.log(`[onRequest] filenameToUse = ${filenameToUse}. Proceeding with KV metadata logic.`);

    let record;
    try {
        record = await env.img_url.getWithMetadata(filenameToUse);
        console.log(`[onRequest] KV getWithMetadata record = ${JSON.stringify(record)}`);
    } catch (e) {
        console.error(`[onRequest] Error getting KV metadata: ${e.message}`);
    }

    if (!record || !record.metadata) {
        console.log('[onRequest] No existing metadata, creating new metadata record.');
        const initMetadata = {
            ListType: "None",
            Label: "None",
            TimeStamp: Date.now(),
            liked: false,
            fileName: filenameToUse,
            fileSize: 0,
        };
        try {
            await env.img_url.put(filenameToUse, "", { metadata: initMetadata });
            console.log('[onRequest] Initial metadata put success.');
        } catch (e) {
            console.error('[onRequest] Error putting initial metadata:', e.message);
        }
        record = { metadata: initMetadata };
    }

    const metadata = {
        ListType: record.metadata.ListType || "None",
        Label: record.metadata.Label || "None",
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
        fileName: record.metadata.fileName || filenameToUse,
        fileSize: record.metadata.fileSize || 0,
    };
    console.log(`[onRequest] metadata after normalization = ${JSON.stringify(metadata)}`);

    if (metadata.ListType === "White") {
        console.log('[onRequest] White list type; returning response.');
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        console.log('[onRequest] Blocked content; redirecting.');
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    if (env.WhiteList_Mode === "true") {
        console.log('[onRequest] Whitelist mode enabled; redirecting to whitelist page.');
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // NOTE: 可以临时注释掉内容审核逻辑来确定是否这是问题点
    if (env.ModerateContentApiKey) {
        try {
            if (!metadata.Label) {
                const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
                console.log(`[onRequest] calling ModerateContent API: ${moderateUrl}`);
                const moderateResponse = await fetch(moderateUrl);
                console.log(`[onRequest] ModerateContent response status = ${moderateResponse.status}`);
                if (moderateResponse.ok) {
                    const moderateData = await moderate
