const {
    ipcRenderer
} = require('electron');

const titleElement = document.getElementById('title');
const filenameElement = document.getElementById('filename');
const progressTextElement = document.getElementById('progress-text');
const progressBarElement = document.getElementById('progress-bar');

ipcRenderer.on('update-game-progress', (event, progressObject) => {
    const {
        title,
        filename,
        percentage,
        textReceived,
        textTotal,
    } = progressObject;

    const percentageInt = parseInt(percentage);

    titleElement.innerHTML = title.toUpperCase();
    filenameElement.innerHTML = filename.toLowerCase();  

    progressTextElement.innerHTML = textReceived + '/' + textTotal;
    progressBarElement.setAttribute('style', 'width:' + percentageInt + '%;');
});