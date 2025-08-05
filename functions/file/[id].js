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
    }
    catch (error) {
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
    let filenameToUse = null;

    // --- 新增：短链接处理逻辑 ---
    if (params.id) {
        // 如果 params.id 存在，说明是短链接
        filenameToUse = params.id;
        if (env.img_url) {
            try {
                const { metadata } = await env.img_url.getWithMetadata(params.id);
                if (metadata && metadata.fileName) {
                    fileIdFromPath = metadata.fileName.split('.')[0];
                }
            } catch (e) {
                console.error("Error fetching short link from KV:", e.message);
            }
        }
    }
    else {
        // 如果 params.id 不存在，按原始长链接处理
        const pathParts = url.pathname.split('/');
        const tempFilename = pathParts.pop();
        if (tempFilename && tempFilename.length > 39) {
            fileIdFromPath = tempFilename.split('.')[0];
            filenameToUse = tempFilename;
        }
    }

    if (fileIdFromPath) {
        const filePath = await getFilePath(env, fileIdFromPath);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }

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

    // --- 修改：短链接处理逻辑确保 KV 可用 ---
    if (!env.img_url || !filenameToUse) {
        return response;
    }
    
    // 从这里开始，下面的代码只在短链接请求时执行
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
                const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
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
