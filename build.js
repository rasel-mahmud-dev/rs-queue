const fs = require('fs-extra');
const path = require('path');

fs.copySync(path.resolve(__dirname, 'package.json'),
    path.resolve(__dirname, 'dist/package.json'));


console.log('Build completed.');
