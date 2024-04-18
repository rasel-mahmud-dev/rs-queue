const fs = require('fs-extra');
const path = require('path');

fs.copySync(path.resolve(__dirname, 'package.json'),
    path.resolve(__dirname, 'build/package.json'));

fs.copySync(path.resolve(__dirname, 'readme.md'),
    path.resolve(__dirname, 'build/readme.md'));


console.log('Build completed.');
