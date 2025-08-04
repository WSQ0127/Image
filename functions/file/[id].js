// 导入其他函数，确保路径正确
// import { getFilePath } from './getFilePath'; 

export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    let originalFileId = null;
    let fileUrl = null;

    // --- NEW LOGIC: 首先处理短链接 ---
    // 如果 URL 匹配了动态路由 [id].js，params.id 会有值，我们将其视为短文件名。
    if (params.id) {
        // 从 KV 存储中根据短文件名获取元数据
        const { metadata } = await env.img_url.getWithMetadata(params.id, { type: 'text' });
        if (metadata && metadata.fileName) {
            // 从元数据中提取原始的长 Telegram 文件ID
            originalFileId = metadata.fileName.split('.')[0];
        }
    }

    // --- ORIGINAL LOGIC: 如果没有短链接，则回退到原始的长链接逻辑 ---
    // 无论是从 KV 存储中获取的，还是旧的长链接，都使用这个逻辑。
    if (originalFileId) {
        // 如果我们找到了原始的文件ID，就用它来获取文件路径
        const filePath = await getFilePath(env, originalFileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        } else {
            return new Response('File not found in Telegram.', { status: 404 });
        }
    } else {
        // 这是您原始的代码逻辑，用于处理来自 telegra.ph 或旧的长 URL
        if (url.pathname.length > 39) {
            const filePath = await getFilePath(env, url.pathname.split(".")[0].split("/")[2]);
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        } else {
            fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
        }
    }

    // 如果经过所有逻辑后 fileUrl 仍然为空，说明文件未找到
    if (!fileUrl) {
        return new Response('File not found.', { status: 404 });
    }

    // 使用最终确定的 fileUrl 去下载文件
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    console.log(response.ok, response.status);

    // --- 原有逻辑：权限和元数据处理 ---

    // 允许管理页面直接访问图片
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return response;
    }

    // 检查 KV 存储是否可用
    if (!env.img_url) {
        console.log("KV storage not available, returning image directly");
        return response;
    }

    // 使用 params.id (即短文件名)作为键来查询 KV
    let record = await env.img_url.getWithMetadata(params.id);
    if (!record || !record.metadata) {
        console.log("Metadata not found, initializing...");
        // 如果元数据不存在，则初始化并保存，以便后续使用
        record = {
            metadata: {
                ListType: "None",
                Label: "None",
                TimeStamp: Date.now(),
                liked: false,
                fileName: params.id, // 这里保存的是短文件名
                fileSize: 0,
            }
        };
        await env.img_url.put(params.id, "", { metadata: record.metadata });
    }

    const metadata = {
        ListType: record.metadata.ListType || "None",
        Label: record.metadata.Label || "None",
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
        fileName: record.metadata.fileName || params.id,
        fileSize: record.metadata.fileSize || 0,
    };

    // 基于 ListType 和 Label 处理重定向
    if (metadata.ListType === "White") {
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // 检查是否开启了白名单模式
    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // 如果开启了内容审核 API，则进行审核
    if (env.ModerateContentApiKey) {
        try {
            console.log("Starting content moderation...");
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);

            if (!moderateResponse.ok) {
                console.error("Content moderation API request failed: " + moderateResponse.status);
            } else {
                const moderateData = await moderateResponse.json();
                console.log("Content moderation results:", moderateData);

                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;

                    if (moderateData.rating_label === "adult") {
                        console.log("Content marked as adult, saving metadata and redirecting");
                        await env.img_url.put(params.id, "", { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            }
        } catch (error) {
            console.error("Error during content moderation: " + error.message);
        }
    }

    // 保存更新后的元数据
    console.log("Saving metadata");
    await env.img_url.put(params.id, "", { metadata });

    // 返回文件内容
    return response;
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
