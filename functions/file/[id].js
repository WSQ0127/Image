export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    // 默认用 telegra.ph 的路径 + search params
    let fileUrl = 'https://telegra.ph' + url.pathname + url.search;

    let file_id = null;

    // 判断如果路径比较长，可能是 Telegram Bot 上传的，通过 file_id 获取真正文件路径
    if (url.pathname.length > 39) {
        const parts = url.pathname.split("/");
        const withExt = parts[2] || "";
        file_id = withExt.split(".")[0];
        const filePath = await getFilePath(env, file_id);
        if (!filePath) {
            return new Response("File not found", { status: 404 });
        }
        fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
    }

    // 构造 fetch 的选项
    const fetchOptions = {
        method: request.method,
        headers: {
            "User-Agent": request.headers.get("User-Agent") || "",
            "Accept": request.headers.get("Accept") || "*/*",
            // 可以根据情况加上一些其它 header
        },
        // 只有在非 GET / HEAD 方法时才加 body
        body: (request.method !== "GET" && request.method !== "HEAD") ? request.body : undefined,
        redirect: "follow",
    };

    let response;
    try {
        response = await fetch(fileUrl, fetchOptions);
    } catch (err) {
        console.error("Fetch error:", err);
        return new Response("Error fetching file", { status: 500 });
    }

    if (!response.ok) {
        return new Response(`Error fetching file: ${response.status}`, { status: response.status });
    }

    // 获取 content-type
    const contentType = response.headers.get("Content-Type") || "application/octet-stream";

    // 构造 filename，尽量保持扩展名
    let filename = params.id;
    if (file_id) {
        // 尝试从 fileUrl 或结果头里获取扩展名
        const urlParts = fileUrl.split("/");
        const last = urlParts[urlParts.length - 1];
        const maybeExt = last.split(".").pop().split("?")[0]; // 粗略提取
        if (maybeExt && maybeExt.length <= 5) {
            filename = `${file_id}.${maybeExt}`;
        } else {
            // 若无法判断扩展名，则不用加
            filename = file_id;
        }
    }

    // 管理内容 & metadata 的逻辑（KV 存储部分）
    if (env.img_url) {
        let record = await env.img_url.getWithMetadata(params.id);
        if (!record || !record.metadata) {
            console.log("Metadata not found, initializing...");
            const initMeta = {
                ListType: "None",
                Label: "None",
                TimeStamp: Date.now(),
                liked: false,
                fileName: filename,
                fileSize: 0,
            };
            await env.img_url.put(params.id, "", { metadata: initMeta });
            record = { metadata: initMeta };
        }
        const metadata = {
            ListType: record.metadata.ListType || "None",
            Label: record.metadata.Label || "None",
            TimeStamp: record.metadata.TimeStamp || Date.now(),
            liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
            fileName: record.metadata.fileName || filename,
            fileSize: record.metadata.fileSize || 0,
        };

        // 管理白名单／黑名单／成人内容逻辑
        if (metadata.ListType === "White") {
            // 直接返回文件
            return buildResponse(response, contentType, filename);
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
                console.log("Starting content moderation...");
                const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
                const moderateResponse = await fetch(moderateUrl);
                if (moderateResponse.ok) {
                    const moderateData = await moderateResponse.json();
                    console.log("Moderation results:", moderateData);
                    if (moderateData.rating_label) {
                        metadata.Label = moderateData.rating_label;
                        if (moderateData.rating_label === "adult") {
                            console.log("Marked as adult, saving metadata and redirecting");
                            await env.img_url.put(params.id, "", { metadata });
                            return Response.redirect(`${url.origin}/block-img.html`, 302);
                        }
                    }
                } else {
                    console.error("Moderation API error status:", moderateResponse.status);
                }
            } catch (e) {
                console.error("Error during content moderation:", e);
            }
        }

        // 如果内容不成人／未被 block，就保存 metadata
        console.log("Saving metadata");
        await env.img_url.put(params.id, "", { metadata });
    }

    // 最后返回文件内容响应，带上下载 header
    return buildResponse(response, contentType, filename);
}


// 工具：从 Telegram API 拿文件路径
async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`getFile API HTTP error: ${res.status}`);
            return null;
        }
        const data = await res.json();
        if (data.ok && data.result && data.result.file_path) {
            return data.result.file_path;
        } else {
            console.error("Invalid getFile response:", data);
            return null;
        }
    } catch (err) {
        console.error("Error in getFilePath:", err);
        return null;
    }
}


// 工具：构建带 Content-Disposition header 的 Response
function buildResponse(sourceResponse, contentType, filename) {
    const headers = new Headers(sourceResponse.headers);

    // 强制下载时的 header
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);

    // 可选：取消某些可能导致问题的 header，比如 gzip, encoding 之类，根据你的源响应
    // headers.delete("Content-Encoding");
    // headers.delete("Content-Security-Policy");

    return new Response(sourceResponse.body, {
        status: sourceResponse.status,
        statusText: sourceResponse.statusText,
        headers: headers,
    });
}
