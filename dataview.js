const { TFile } = obsidian;
const crypto = require('crypto');

async function executeQueryAndSave() {    
    // 1. 获取所有带有 #share 标签的笔记，并按文件路径排序
    let result = dv.pages().where(p => p.file.tags.includes("#share"))
        .sort(p => p.file.path, 'asc'); // 按路径升序排序

    // 2. 格式化查询结果为纯文本内容
    let output = "";
    for (let page of result) {
      output += `${page.file.path}\n`;
    }
    
    // 使用 Obsidian API 保存到文件
    const folder = "9.输出/hexo"; // 目标文件夹的名称，如果没有可以自己创建
    const fileName = "Share_Tagged_Notes.md"; // 目标文件的名称
    
    // 检查文件夹是否存在，如果不存在就创建它
    if (!app.vault.getAbstractFileByPath(folder)) {
        await app.vault.createFolder(folder);
    }
    
    // 构建文件路径
    const filePath = folder + "/" + fileName;
    
    // 检查文件是否存在
    let file = app.vault.getAbstractFileByPath(filePath);
    if (file) {    
        // 如果文件存在，直接覆盖内容
        await app.vault.modify(file, output);
    } else {
        // 如果文件不存在，则创建新文件并写入内容
        await app.vault.create(filePath, output);
    }

    // 获取结果的长度
    let resultLength = result.length;
    
    // **在这里调用新的函数来处理笔记**
    await processNotes(result);
    new Notice(`${resultLength} 笔记已成功更新！`);   

    // **调用自动部署函数**
    await deployHexoSite();
}

// 实现 getSha1 函数
function getSha1(content) {
    return crypto.createHash('sha1').update(content).digest('hex');
}

// 实现 pathToTags 函数
function pathToTags(filePath, basePath) {
    const path = require('path');

    // 统一路径分隔符
    filePath = filePath.replace(/\\/g, '/');
    basePath = basePath.replace(/\\/g, '/');

    // 确保基础路径末尾有斜杠
    if (!basePath.endsWith('/')) {
        basePath += '/';
    }

    // 移除基础路径和文件名
    let relativePath = filePath.replace(basePath, '').split('/').slice(0, -1).join('/');

    // 分割路径
    let parts = relativePath.split('/');

    // 处理标签：移除空字符串、数字前缀，并处理特殊标记
    let tags = [];
    parts.forEach(part => {
        if (part) {
            // 移除数字前缀
            part = part.replace(/^\d+\./, '');
            // 处理特殊标记（如 _What_）
            part = part.replace(/^_(.+)_$/, '$1');
            tags.push(part);
        }
    });

    return tags;
}

// **新的函数，用于处理笔记并生成 Quartz 所需的文件**
async function processNotes(pages) {
    // 配置参数，您可以根据需要调整
    const config = {
        pathFrom: app.vault.adapter.basePath, // Obsidian 笔记的根目录
        pathTo: "D:/Git/Note/quartz", // Quartz 博客的根目录
        resourceFolder: "res", // 资源文件夹
        excludeFolders: ["res", "stash", ".obsidian", "7.输入", ".git"], // 排除的文件夹
        shareTag: "#share", // 分享标签
        includeBacklinks: false // 是否包含 Backlinks（默认 false）
    };

    const fs = require('fs');
    const path = require('path');

    // 创建 notesMap，存储笔记路径到笔记对象的映射
    let notesMap = new Map();
    // 创建 backlinksMap，存储笔记路径到其 backlinks 的映射
    let backlinksMap = new Map();

    // 遍历每个页面，预处理笔记，生成 create_hash，并存储到 notesMap
    for (let page of pages) {
        // 获取文件的相对路径
        let filePathRelative = page.file.path; // 相对于 Vault 根目录的路径

        // 生成 create_hash
        let create_hash;
        if (page.file.name.toLowerCase() === 'index') {
            create_hash = page.file.name;
        } else {
            create_hash = getSha1(filePathRelative);
        }

        // 将 create_hash 存储在 page 对象中
        page.create_hash = create_hash;

        // 将笔记添加到 notesMap 中
        notesMap.set(filePathRelative, page);
    }

    // 第二次遍历，处理笔记内容并保存
    for (let page of pages) {
        // 读取笔记内容
        let tfile = app.vault.getAbstractFileByPath(page.file.path);
        if (!(tfile instanceof TFile)) {
            console.error(`无法找到路径对应的文件：${page.file.path}`);
            continue;
        }

        // 读取文件内容
        let fileContent = await app.vault.cachedRead(tfile);

        // **跳过第一行内容**
        let lines = fileContent.split('\n');
        lines.shift(); // 移除第一行
        fileContent = lines.join('\n');

        // 处理标签
        let tags = page.file.tags.map(tag => tag.replace("#", ""));
        let isShare = tags.includes(config.shareTag.replace("#", ""));
        let isTop = tags.includes("top");

        // 处理内部链接、图片和附件
        fileContent = await processContent(fileContent, page, config, notesMap, backlinksMap);
        
        // 生成元数据（Front Matter）
        let frontMatter = generateFrontMatter(page, tags, isTop, config);

        // 合并元数据和内容
        let newContent = frontMatter + "\n" + fileContent;

        // 将新内容存储在 page 对象中
        page.newContent = newContent;

        console.log(`处理笔记：${page.create_hash} ${page.file.name}`);
    }

    // 处理 backlinks
    for (let [linkedFilePath, backlinkPaths] of backlinksMap.entries()) {
        if (notesMap.has(linkedFilePath)) {
            let linkedPage = notesMap.get(linkedFilePath);
            // Get the backlinks as an array
            let backlinks = Array.from(backlinkPaths).map(backlinkPath => {
                if (notesMap.has(backlinkPath)) {
                    let backlinkPage = notesMap.get(backlinkPath);
                    return `[${backlinkPage.file.name}](/${backlinkPage.create_hash})`;
                } else {
                    return '';
                }
            }).filter(link => link !== '');

            // Append backlinks to the content of linkedPage
            if (backlinks.length > 0 && config.includeBacklinks) {
                linkedPage.newContent += '\n\n## Backlinks\n\n';
                backlinks.forEach(link => {
                    linkedPage.newContent += `- ${link}\n`;
                });
            }
        }
    }

    // 保存笔记到 Quartz 博客目录
    for (let page of pages) {
        await saveToHexo(page, config);
        console.log(`生成笔记：${page.create_hash} ${page.file.name}`);
    }
}

// 处理笔记内容，替换内部链接、资源路径，并清理内容
async function processContent(content, page, config, notesMap, backlinksMap) {
    const fs = require('fs');
    const path = require('path');

    // 定义有效的图片扩展名列表
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg'];

    // **处理图片链接**：以 ! 开头的链接
    content = content.replace(/!\[\[(.*?)\]\]|!\[.*?\]\(\s*(<.*?>|.*?)\s*\)/g, (match, p1, p2) => {
        let resourcePath = p1 || p2;
        if (!resourcePath) {
            return match;
        }

        // 移除尖括号（如果有）
        if (resourcePath.startsWith('<') && resourcePath.endsWith('>')) {
            resourcePath = resourcePath.slice(1, -1).trim();
        }

        console.log(`处理图片链接：${resourcePath}`);

        // 如果是 HTTP 链接，直接返回原始内容
        if (resourcePath.startsWith("http")) {
            return match;
        }

        // 复制资源文件到 Quartz 目录
        if (copyResource(resourcePath, config, 'images')) {
            return `![](/images/${encodeURI(resourcePath)})`;
        } else {
            console.warn(`资源文件不存在：${resourcePath}`);
            return `![Missing Image](${resourcePath})`;
        }
    });

    // **处理文件链接**：不以 ! 开头的链接
    content = content.replace(/\[\[(.*?)\]\]|\[([^\]]+)\]\(\s*(<.*?>|.*?)\s*\)/g, (match, p1, p2, p3) => {
        // 如果是 [[...]] 格式，p1 有值；如果是 [text](link) 格式，p2 和 p3 有值
        let linkText, resourcePath;
        if (p1) {
            // [[...]] 格式
            let linkInner = p1.trim();
            // 处理别名 [[link|alias]]
            let [linkTarget, linkAlias] = linkInner.split('|');
            resourcePath = linkTarget.trim();
            linkText = linkAlias ? linkAlias.trim() : linkTarget.trim();
        } else {
            // [text](link) 格式
            linkText = p2.trim();
            resourcePath = p3.trim();
            // 移除尖括号（如果有）
            if (resourcePath.startsWith('<') && resourcePath.endsWith('>')) {
                resourcePath = resourcePath.slice(1, -1).trim();
            }
        }

        // 如果是 HTTP 链接或锚点链接，直接返回原始内容
        if (resourcePath.startsWith("http") || resourcePath.startsWith("#")) {
            return match;
        }

        // 检查文件是否存在于资源文件夹中
        let resourceFullPath = path.join(config.pathFrom, config.resourceFolder, resourcePath);
        if (fs.existsSync(resourceFullPath)) {
            // 检查是否为图片
            let ext = path.extname(resourcePath).toLowerCase();
            if (imageExtensions.includes(ext)) {
                // 图片资源，复制到 images 文件夹
                if (copyResource(resourcePath, config, 'images')) {
                    return `![](/images/${encodeURI(resourcePath)})`;
                } else {
                    console.warn(`资源文件不存在：${resourcePath}`);
                    return `![Missing Image](${resourcePath})`;
                }
            } else {
                // 非图片资源，复制到 download 文件夹
                if (copyResource(resourcePath, config, 'download')) {
                    return `[${linkText}](/download/${encodeURI(resourcePath)})`;
                } else {
                    console.warn(`文件资源不存在：${resourcePath}`);
                    return `[${linkText}](#)`;
                }
            }
        } else {
            // 资源文件不存在，可能是 Obsidian 内部链接
            // 处理内部链接和别名，以及标题锚点

            // 处理可能存在的标题锚点
            let heading = null;
            if (resourcePath.includes('#')) {
                let parts = resourcePath.split('#');
                resourcePath = parts[0].trim();
                heading = parts[1] ? parts[1].trim() : null;
            }

            // 使用 app.metadataCache.getFirstLinkpathDest 来解析内部链接
            let linkedFile = app.metadataCache.getFirstLinkpathDest(resourcePath, page.file.path);

            if (linkedFile) {
                let linkedFilePathFull = linkedFile.path;
                // 检查 linkedFilePath 是否在 notesMap 中
                if (notesMap.has(linkedFilePathFull)) {
                    let linkedPage = notesMap.get(linkedFilePathFull);
                    let linkedHash = linkedPage.create_hash;

                    // 添加到 backlinksMap
                    if (!backlinksMap.has(linkedFilePathFull)) {
                        backlinksMap.set(linkedFilePathFull, new Set());
                    }
                    backlinksMap.get(linkedFilePathFull).add(page.file.path);

                    // 构建链接
                    let linkHref;
                    if (heading) {
                        linkHref = `${linkedHash}#${encodeURIComponent(heading)}`;
                    } else {
                        linkHref = `${linkedHash}`;
                    }

                    return `[${linkText}](${linkHref})`;
                } else {
                    // 如果链接的笔记不在 notesMap 中，可能不需要处理，或者用原始的链接
                    console.warn(`链接的笔记未找到或未包含在分享范围内：${resourcePath}`);
                    return match;
                }
            } else {
                // 无法解析链接，返回原始内容
                console.warn(`无法解析内部链接：${resourcePath}`);
                return match;
            }
        }
    });

    // **内容清理，根据 Python 代码的 get_full_content 方法**

    // 1. 移除代码块标记或 '??' 后的任何字符，直到下一个空白字符
    content = content.replace(/((```[\w]*|\?\?)(?=\s))(.*)/g, '$1');

    // 2. 将 '```run-' 替换为 '```'
    content = content.replace(/```run-/g, '```');

    // 3. 将以 '??' 开头的行及其后面的字符替换为空格
    content = content.replace(/\?\?.*/g, '  ');

    // 4. 在二级及以上标题前插入两个空格
    content = content.replace(/(\n)(#{2,})/g, '$1  $2');

    // 5. 确保在二级及以上标题前有一个换行符
    content = content.replace(/([^\n])(\n#{2,})/g, '$1\n  $2');

    // 6. 确保标题后有一个空行
    content = content.replace(/(#{2,}.*\n)(?!\n)/g, '$1\n');

    return content;
}

// 生成元数据（Front Matter）
function generateFrontMatter(page, tags, isTop, config) {
    const path = require('path');

    // 从文件路径中获取分类
    let filePath = path.join(config.pathFrom, page.file.path);
    let categories = pathToTags(filePath, config.pathFrom);

    let frontMatter = `---\n`;
    frontMatter += `title: "${page.file.name}"\n`;
    frontMatter += `date: "${new Date(page.file.ctime).toISOString()}"\n`;
    frontMatter += `updated: "${new Date(page.file.mtime).toISOString()}"\n`;
    frontMatter += `categories:\n`;
    categories.forEach(cat => {
        frontMatter += `  - "${cat}"\n`;
    });
    frontMatter += `tags:\n`;
    tags.forEach(tag => {
        frontMatter += `  - "${tag}"\n`;
    });
    if (isTop) {
        frontMatter += `top: true\n`;
    }
    frontMatter += `---\n`;
    return frontMatter;
}

// 将新内容保存到 Quartz 博客目录
async function saveToHexo(page, config) {
    const fs = require('fs');
    const path = require('path');

    // 获取文件的相对路径
    let filePathRelative = page.file.path; // 相对于 Vault 根目录的路径
    let fileDir = path.dirname(filePathRelative);

    // 使用 create_hash 作为文件名
    let fileName = page.create_hash + '.md';

    // 构建保存路径
    let notePath = path.join(config.pathTo, 'content', fileDir, fileName);

    // 确保目录存在
    fs.mkdirSync(path.dirname(notePath), { recursive: true });

    // 写入文件
    fs.writeFileSync(notePath, page.newContent, 'utf8');
}

// 复制资源文件到 Quartz 博客目录
function copyResource(resourcePath, config, targetFolder = 'images') {
    const fs = require('fs');
    const path = require('path');

    // 解码资源路径中的编码字符（例如，将 %20 转换回空格）
    let decodedResourcePath = decodeURI(resourcePath);

    // 使用 path.join 来处理路径，避免手动拼接
    let fromPath = path.join(config.pathFrom, config.resourceFolder, decodedResourcePath);
    let toPath = path.join(config.pathTo, 'content', targetFolder, decodedResourcePath);

    console.log(`复制资源文件：从 ${fromPath} 到 ${toPath}`);

    // 检查源文件是否存在
    if (!fs.existsSync(fromPath)) {
        console.error(`源文件不存在：${fromPath}`);
        return false;
    }

    // 确保目录存在
    fs.mkdirSync(path.dirname(toPath), { recursive: true });

    // 复制文件
    try {
        fs.copyFileSync(fromPath, toPath);
        console.log(`成功复制文件：${fromPath}`);
        return true;
    } catch (error) {
        console.error(`复制文件时出错：${error}`);
        return false;
    }
}

// 部署 Quartz 网站
async function deployHexoSite() {
    // 请将此替换为您的实际命令 ID (从 Shell Commands 插件设置中获取)
    const commandId = "obsidian-shellcommands:shell-command-mt9wsz27vz"; 

    if (app.commands.commands[commandId]) {
        await app.commands.executeCommandById(commandId);
        new Notice("Quartz 博客已自动部署！");
    } else {
        new Notice(`未找到命令 ID 为 "${commandId}" 的 Shell Command。`);
    }
}

// **添加一个按钮来手动触发函数**
// 创建按钮元素
let button = document.createElement('button');
button.textContent = "更新 share 笔记"; // 按钮显示的文字
button.id = "exportButton";
button.className = "mod-cta";

// 添加点击事件监听器
button.addEventListener('click', async () => {
    try{        
        await executeQueryAndSave();
    } catch (error) {
        // 错误处理
        console.error('执行失败：', error); // 在控制台输出错误信息，按 Ctrl + Shift + I 查看
    } 
});

// 将按钮添加到当前视图的容器中
dv.container.appendChild(button);

// 添加一些基本样式
const style = document.createElement('style');
style.textContent = `
    #exportButton {
        margin: 10px 0;
        padding: 6px 12px;
        cursor: pointer;
    }
    #exportButton:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }
`;
dv.container.appendChild(style);
