const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let oldContent = content;
    // First CV DebugMate C++ to C++ DebugMate
    content = content.replace(/CV DebugMate C\+\+/g, 'C++ DebugMate');
    // Then CV DebugMate to C++ DebugMate
    content = content.replace(/CV DebugMate/g, 'C++ DebugMate');
    
    if (content !== oldContent) {
        fs.writeFileSync(filePath, content);
        console.log(`Replaced in ${filePath}`);
    }
}

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!['node_modules', 'dist', 'build', 'out', '.git', '.vscode-test', 'assets'].includes(file)) {
                processDir(fullPath);
            }
        } else {
            if (/\.(md|json|ts|cpp|sh|ps1)$/.test(file)) {
                replaceInFile(fullPath);
            }
        }
    }
}

processDir('.');
