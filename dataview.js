
const { TFile } = obsidian;

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
    
    // 通知用户文件已更新
        
    // **在这里调用新的函数来处理笔记**
    await processNotes(result);
    new Notice(`${resultLength} 笔记已成功更新！`);   

    // **调用自动部署函数**
    await deployHexoSite();
}


// **新的函数，用于处理笔记并生成 Hexo 所需的文件**
async function processNotes(pages) {
    // 配置参数，您可以根据需要调整
    const config = {
        pathFrom: app.vault.adapter.basePath, // Obsidian 笔记的根目录
        pathTo: "D:/Git/Note/quartz/content", // Hexo 博客的根目录
        resourceFolder: "res", // 资源文件夹
        excludeFolders: ["res", "stash", ".obsidian", "7.输入", ".git"], // 排除的文件夹
        shareTag: "#share" // 分享标签
    };

    const fs = require('fs');
    const path = require('path');

    // 遍历每个页面，处理内容
    for (let page of pages) {
        // 读取笔记内容
        let tfile = app.vault.getAbstractFileByPath(page.file.path);
        if (!(tfile instanceof TFile)) {
            console.error(`无法找到路径对应的文件：${page.file.path}`);
            return;
        }

        // 读取文件内容
        let fileContent = await app.vault.cachedRead(tfile);
        let metadata = app.metadataCache.getFileCache(page.file);

        // 处理标签
        let tags = page.file.tags.map(tag => tag.replace("#", ""));
        let isShare = tags.includes(config.shareTag.replace("#", ""));
        let isTop = tags.includes("top");

        // 处理内部链接、图片和附件
        fileContent = await processContent(fileContent, page, config);
        
        // 生成元数据（Front Matter）
        let frontMatter = generateFrontMatter(page, tags, isTop);

        // 合并元数据和内容
        let newContent = frontMatter + "\n" + fileContent;

        // 将新内容写入 Hexo 博客目录
        await saveToHexo(newContent, page, config);
    }
}

// 处理笔记内容，替换内部链接和资源路径
async function processContent(content, page, config) {
    const fs = require('fs');
    const path = require('path');

    // 定义有效的图片扩展名列表
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg'];

    // 处理内部链接 [[...]]
    content = content.replace(/\[\[([^\]]+)\]\]/g, (match, p1) => {
        // 提取链接的文件名
        let linkName = p1.split("|")[0];
        let linkPath = linkName.replace(/\/|\\/g, "_");
        return `[${linkName}](${linkPath}.html)`;
    });

    // 处理图片和附件 ![[...]] (Obsidian 内部图片嵌入)
    content = content.replace(/!\[\[([^\]]+)\]\]/g, (match, p1) => {
        let resourcePath = p1.trim();
        // 检查文件是否为图片
        let ext = path.extname(resourcePath).toLowerCase();
        if (imageExtensions.includes(ext)) {
            // 复制资源文件到 Hexo 目录
            if (copyResource(resourcePath, config)) {
                return `![](/images/${encodeURIComponent(resourcePath)})`;
            } else {
                console.warn(`资源文件不存在：${resourcePath}`);
                return `![Missing Image](${resourcePath})`;
            }
        } else {
            // 非图片文件，保留原始内容
            return match;
        }
    });

    // 处理外部资源链接 ![...](...)
    content = content.replace(/!\[.*?\]\((.+?)\)/g, (match, p1) => {
        let resourcePath = p1.trim();

        // 如果是 HTTP 链接，直接返回原始内容
        if (resourcePath.startsWith("http")) {
            return match;
        }

        // 检查文件扩展名是否是有效的图片格式
        let ext = path.extname(resourcePath).toLowerCase();
        if (imageExtensions.includes(ext)) {
            // 复制资源文件到 Hexo 目录
            if (copyResource(resourcePath, config)) {
                return `![](/images/${encodeURIComponent(resourcePath)})`;
            } else {
                console.warn(`资源文件不存在：${resourcePath}`);
                return `![Missing Image](${resourcePath})`;
            }
        } else {
            // 非图片文件，可能是附件或其他文件，视情况处理
            // 如果需要处理附件，可以在这里添加处理逻辑
            return match;
        }
    });

    return content;
}

// 生成元数据（Front Matter）
function generateFrontMatter(page, tags, isTop) {
    let frontMatter = `---\n`;
    frontMatter += `title: "${page.file.name}"\n`;
    frontMatter += `date: "${new Date(page.file.ctime).toISOString()}"\n`;
    frontMatter += `updated: "${new Date(page.file.mtime).toISOString()}"\n`;
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

// 将新内容保存到 Hexo 博客目录
async function saveToHexo(content, page, config) {
    const fs = require('fs');
    const path = require('path');

    // 构建保存路径
    let hexoContentPath = path.join(config.pathTo, "source", "_posts");
    let fileName = page.file.name.replace(/\/|\\/g, "_") + ".md";
    let filePath = path.join(hexoContentPath, fileName);

    // 确保目录存在
    fs.mkdirSync(hexoContentPath, { recursive: true });

    // 写入文件
    fs.writeFileSync(filePath, content, 'utf8');
}

// 复制资源文件到 Hexo 博客目录
function copyResource(resourcePath, config) {
    const fs = require('fs');
    const path = require('path');

    let fromPath = path.join(config.pathFrom, config.resourceFolder, resourcePath);
    let toPath = path.join(config.pathTo, "source", "images", resourcePath);

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
        return true;
    } catch (error) {
        console.error(`复制文件时出错：${error}`);
        return false;
    }
}

// 部署
async function deployHexoSite() {
    // 请将此替换为您的实际命令 ID (从shell command设置处获取)
    const commandId = "obsidian-shellcommands:shell-command-mt9wsz27vz"; 

    if (app.commands.commands[commandId]) {
        await app.commands.executeCommandById(commandId);
        new Notice("Hexo 博客已自动部署！");
    } else {
        new Notice(`未找到命令 ID 为 "${commandId}" 的 Shell Command。`);
    }
}


// **添加一个按钮来手动触发函数**
// 创建按钮元素
let button = document.createElement('button');
button.textContent = "更新share笔记"; // 按钮显示的文字
button.id = "exportButton";
button.className = "mod-cta";

// 添加点击事件监听器
button.addEventListener('click', async () => {
    try{        
        await executeQueryAndSave();
    } catch (error) {
        // 错误处理
        // new Notice(`执行失败：${error.message}`, 5000);
        console.error('执行失败：', error); // 在控制台输出错误信息 ctrl + shift + i 查看
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