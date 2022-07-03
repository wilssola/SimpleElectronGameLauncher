const {
    app,
    ipcMain,
    BrowserWindow,
} = require('electron');

const {
    exec,
} = require('child_process');

const fs = require('fs');
const path = require('path');
const request = require('request');

const DecompressZip = require('decompress-zip');

const kTitle = 'Launcher';

const kExperienceGetSeconds = '60';
const kExperiencesGetUrl = 'http://cuderoger.tecwolf.com.br/launcher/experiences.json';

const kIsMac = process.platform == 'darwin';
const kIsWindows = process.platform == 'win32';

const kExtensionMac = '.app';
const kExtensionWindows = '.bat';

const kVersionMac = 'macver.json'
const kVersionWindows = 'winver.json';
const kVersionFile = !kIsMac ? kVersionWindows : kVersionMac;

const userDataPath = app.getPath('userData');
const appsPath = path.join(userDataPath, 'Apps');
const downloadsPath = path.join(userDataPath, 'Downloads');

let mainWindow;
let progressWindow;
let experiencesObject;

let gameProcess;
let gameInstallUnzipper;
let gameDownloadRequest;

const openMainWindow = () => {
    if (mainWindow == null) {
        mainWindow = new BrowserWindow({
            title: kTitle,
            width: 1024,
            height: 600,
            minWidth: 512,
            minHeight: 300,
            frame: true,
            resizable: true,
            fullscreenable: false,
            autoHideMenuBar: true,
            webPreferences: {
                devTools: false,
                nodeIntegration: true,
                contextIsolation: false,
                preload: path.join(__dirname, 'assets', 'scripts', 'preload.js'),
            },
        });

        mainWindow.loadFile(path.join(__dirname, 'assets', 'views', 'experiences.html'));

        mainWindow.on('ready-to-show', loopGetExperiences);
        mainWindow.on('close', () => {
            mainWindow = null;

            stopAll();

            app.quit();
            app.exit(0);
        });

        mainWindow.setMenu(null);

        return;
    }

    showMainWindow();
};

const showMainWindow = () => {
    if (mainWindow != null)
        mainWindow.show();
}

const hideMainWindow = () => {
    if (mainWindow != null)
        mainWindow.hide();
}

const showProgressWindow = () => {
    if (mainWindow != null && progressWindow != null)
        progressWindow.show();
}

const hideProgressWindow = () => {
    if (mainWindow != null && progressWindow != null)
        progressWindow.hide();
}

const openProgressWindow = () => {
    if (progressWindow == null) {
        progressWindow = new BrowserWindow({
            title: 'Launcher',
            width: 512,
            height: 256,
            frame: false,
            resizable: false,
            fullscreenable: false,
            autoHideMenuBar: true,
            minimizable: false,
            alwaysOnTop: true,
            transparent: true,
            backgroundColor: '#F9F9F9',
            hasShadow: true,
            webPreferences: {
                devTools: false,
                nodeIntegration: true,
                contextIsolation: false,
            },
        });

        progressWindow.loadFile(path.join(__dirname, 'assets', 'views', 'progress.html'));

        progressWindow.on('close', () => {
            progressWindow = null;

            stopAll();
        });

        progressWindow.setMenu(null);

        return;
    }

    showProgressWindow();
};

const stopAll = () => {
    if (gameProcess != null) {
        gameProcess.kill();
        gameProcess = null;
    }

    if (gameDownloadRequest != null) {
        gameDownloadRequest.abort();
        gameDownloadRequest = null;
    }

    if (gameInstallUnzipper != null) {
        gameInstallUnzipper.closeFile();
        gameInstallUnzipper = null;
    }
}

const playGame = (id) => {
    if (gameDownloadRequest == null && gameInstallUnzipper == null) {
        // Get experiences again to be sure that not losing any update.
        getExperiences();

        const gameObject = experiencesObject[id];

        if (!fs.existsSync(appsPath)) {
            fs.mkdirSync(appsPath);
        }

        const gamePath = path.join(appsPath, gameObject.id);
        const gameVersionPath = path.join(gamePath, kVersionFile);

        const gameIsInstalled = fs.existsSync(gameVersionPath);

        const gameVersionFile = gameIsInstalled ? JSON.parse(fs.readFileSync(gameVersionPath, 'utf-8')) : null;
        const gameVersion = gameVersionFile != null ? gameVersionFile.version : '';

        const gameIsUpdated = gameVersion == (!kIsMac ? gameObject.winver : gameObject.macver);

        if (!gameIsInstalled || !gameIsUpdated) {
            if (gameIsInstalled && !gameIsUpdated) {
                // Delete game installation before download new version.
                fs.rmSync(gamePath, {
                    recursive: true,
                    force: true,
                });
            }

            // Download new game version.
            downloadGame(gameObject);

            return;
        }

        // Run game if is installed and updated.
        runGame(gameObject);
    }
};

const runGame = (gameObject) => {
    const gamePath = path.join(appsPath, gameObject.id);
    const gameExecutableExtension = !kIsMac ? kExtensionWindows : kExtensionMac;

    const gameDirectory = fs.readdirSync(gamePath);

    for (const fileKey in gameDirectory) {
        if (path.extname(gameDirectory[fileKey]) === gameExecutableExtension) {
            const executableFile = path.basename(gameDirectory[fileKey]);
            const executablePath = path.join(gamePath, executableFile);

            const arguments = '-AppCommandLineArg';

            // start ./AppName.exe -AppCommandLineArg
            const windowsStart = 'start ' + executableFile + ' ' + arguments;
            // open ./AppName.app --args -AppCommandLineArg
            const macOpen = 'open -a' + executableFile + ' --args ' + arguments;

            const execCommand = !kIsMac ? windowsStart : macOpen;

            gameProcess = exec(execCommand, {
                cwd: gamePath,
            });

            gameProcess.on('close', showMainWindow);

            hideMainWindow();
        }
    }
}

const downloadGame = (gameObject) => {
    openProgressWindow();

    const link = !kIsMac ? gameObject.windows : gameObject.mac;
    const filename = nameFromLink(link);
    if (link.length <= 0) {
        progressWindow.on('ready-to-show', () => updateGameProgress('Not Found', filename));
        return;
    }

    const gameDownloadPath = path.join(downloadsPath, filename);

    gameDownloadRequest = request({
        method: 'GET',
        url: link,
    });

    // Create downloads folder if not exists.
    if (!fs.existsSync(downloadsPath)) {
        fs.mkdirSync(downloadsPath);
    }
    // Delete previous download if exists.
    if (fs.existsSync(gameDownloadPath)) {
        fs.unlinkSync(gameDownloadPath);
    }

    const gameDownloadOutput = fs.createWriteStream(gameDownloadPath);
    gameDownloadRequest.pipe(gameDownloadOutput);

    const kMegaByteSymbol = ' MB';
    const kMegaByteInBytes = 1024 * 1024;

    let receivedBytes = 0;
    let totalBytes = 0;

    // On have a response. Get totalBytes.
    gameDownloadRequest.on('response', data => {
        const {
            headers
        } = data;

        totalBytes = parseInt(headers['content-length']);
    });

    // On new part of total data Download. Update receivedBytes.
    gameDownloadRequest.on('data', chunk => {
        receivedBytes += chunk.length;

        const textReceivedMegaBytes = (receivedBytes / kMegaByteInBytes).toFixed(2) + kMegaByteSymbol;
        const textTotalMegaBytes = (totalBytes / kMegaByteInBytes).toFixed(2) + kMegaByteSymbol;

        // Update download progress.
        updateGameProgress('Downloading Game...', filename, textReceivedMegaBytes, textTotalMegaBytes, receivedBytes, totalBytes);

        console.error('Request Data:', chunk);
    });

    // On finish download call install.
    gameDownloadRequest.on('end', () => {
        hideProgressWindow();

        if (mainWindow != null)
            mainWindow.webContents.send('download-game-end');

        // Reset download progress.
        updateGameProgress();

        installGame(gameObject, filename, gameDownloadPath);

        gameDownloadRequest = null;
    });

    gameDownloadRequest.on('error', error => {
        updateGameProgress('Error', error.message);

        setTimeout(hideProgressWindow, 5000);

        console.error('Request Error:', error);
    });
};

const installGame = (gameObject, downloadFilename, downloadPath) => {
    openProgressWindow();

    const gameInstallPath = path.join(appsPath, gameObject.id);
    const gameVersionPath = path.join(gameInstallPath, kVersionFile);

    gameInstallUnzipper = new DecompressZip(downloadPath);

    gameInstallUnzipper.on('progress', (fileIndex, fileCount) => {
        fileIndex = fileIndex + 1;

        const textFileIndex = 'FILE ' + fileIndex;
        const textFileCount = fileCount + ' FILES';

        updateGameProgress('Installing Game...', downloadFilename, textFileIndex, textFileCount, fileIndex, fileCount);

        console.log('Unzipper Progress:', textFileIndex + '/' + textFileCount);
    });

    gameInstallUnzipper.on('extract', log => {
        // Delete game downloaded file after installation.
        fs.unlinkSync(downloadPath);

        // Create game version file for new version downloaded.
        const versionFile = {
            id: gameObject.id,
            version: !kIsMac ? gameObject.winver : gameObject.macver
        };
        fs.writeFileSync(gameVersionPath, JSON.stringify(versionFile));

        hideProgressWindow();

        if (mainWindow != null)
            mainWindow.webContents.send('install-game-end');

        updateGameProgress();

        runGame(gameObject);

        gameInstallUnzipper = null;

        console.log('Unzipper Success:', log);
    });

    gameInstallUnzipper.on('error', error => {
        updateGameProgress('Error', error.message);

        setTimeout(hideProgressWindow, 5000);

        console.error('Unzipper Error:', error);
    });

    gameInstallUnzipper.extract({
        path: gameInstallPath,
        filter: (file) => file.type !== 'SymbolicLink'
    });
};

const updateGameProgress = (title = '', filename = '', textReceived = '0', textTotal = '0', received = 0, total = 0) => {
    const percentage = (received * 100) / total;

    const progressObject = {
        title: title,
        filename: filename,
        percentage: percentage,
        textReceived: textReceived,
        textTotal: textTotal,
    };

    if (mainWindow != null && progressWindow != null)
        progressWindow.webContents.send('update-game-progress', progressObject);

    console.log('Progress Percentage:', percentage.toFixed(2) + '%');
    console.log('Progress Bytes:', received + '/' + total);
};

const nameFromLink = (link) => {
    const slicedUrl = link.split('/');
    const filename = slicedUrl[slicedUrl.length - 1];
    return filename;
};

const getExperiences = () => {
    request({
        url: kExperiencesGetUrl,
    }, (error, response, body) => {
        const somethingWrong = error || !body || response.statusCode != 200;

        experiencesObject = !somethingWrong ? JSON.parse(body) : null;

        if (mainWindow != null)
            mainWindow.webContents.send('get-experiences', experiencesObject);
    });
};

const loopGetExperiences = () => {
    getExperiences();
    setTimeout(() => loopGetExperiences(), 1000 * kExperienceGetSeconds);
};

app.whenReady().then(() => {
    openMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            openMainWindow();
        }
    });
});

app.on('window-all-closed', () => !kIsMac ? app.quit() : null);

ipcMain.on('play-game', (event, id) => playGame(id));