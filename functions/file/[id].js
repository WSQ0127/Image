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
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    let fileIdFromPath = null;
    let filenameToUse = params.id;

    // --- 步骤1: 优先处理短链接 ---
    if (env.img_url) {
        try {
            const { metadata } = await env.img_url.getWithMetadata(filenameToUse);
            if (metadata && metadata.fileName) {
                fileIdFromPath = metadata.fileName.split('.')[0];
            }
        } catch (e) {
            console.error("Error fetching short link from KV:", e.message);
        }
    }

    // --- 步骤2: 如果不是短链接，检查是否为长链接 ---
    if (!fileIdFromPath && filenameToUse && filenameToUse.length > 39) {
        fileIdFromPath = filenameToUse.split(".")[0];
    }

    // --- 步骤3: 根据文件 ID 获取实际的下载 URL ---
    if (fileIdFromPath) {
        const filePath = await getFilePath(env, fileIdFromPath);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        } else {
            return new Response('File not found', { status: 404 });
        }
    }

    // --- 以下是你原始代码中的通用处理逻辑 ---
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return response;
    }

    if (!env.img_url) {
        return response;
    }

    let record = await env.img_url.getWithMetadata(filenameToUse);
    if (!record || !record.metadata) {
        record = {
            metadata: {
                ListType: "None",
                Label: "None",
                TimeStamp: Date.now(),
                liked: false,
                fileName: filenameToUse,
                fileSize: 0,
            }
        };
        await env.img_url.put(filenameToUse, "", { metadata: record.metadata });
    }

    const metadata = {
        ListType: record.metadata.ListType || "None",
        Label: record.metadata.Label || "None",
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
        fileName: record.metadata.fileName || filenameToUse,
        fileSize: record.metadata.fileSize || 0,
    };

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

    if (env.ModerateContentApiKey) {
        try {
            if (!metadata.Label) {
                const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=${fileUrl}`;
                const moderateResponse = await fetch(moderateUrl);
                if (moderateResponse.ok) {
                    const moderateData = await moderateResponse.json();
                    if (moderateData && moderateData.rating_label) {
                        metadata.Label = moderateData.rating_label;
                        if (moderateData.rating_label === "adult") {
                            await env.img_url.put(filenameToUse, "", { metadata });
                            return Response.redirect(`${url.origin}/block-img.html`, 302);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error during content moderation: " + error.message);
        }
    }

    await env.img_url.put(filenameToUse, "", { metadata });
    return response;
}
