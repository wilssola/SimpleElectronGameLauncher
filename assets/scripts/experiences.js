const {
    ipcRenderer
} = require('electron');

const experiencesElement = document.getElementById('experiences');

const PlayGame = (id) => ipcRenderer.send('play-game', id);

window.experiencesObject = null;

ipcRenderer.on('get-experiences', (event, experiencesObject) => {
    if(experiencesObject == null) {
        experiencesElement.innerHTML = 'Not Found';
        return;
    }

    experiencesElement.innerHTML = '';

    if (experiencesObject != null) {
        for (const experienceKey in experiencesObject) {
            const gameElement = document.createElement('a');
            const gameImage = document.createElement('img');
            const gameName = document.createElement('h4');
            const gameDescription = document.createElement('p');

            const {
                id,
                name,
                description,
                picture
            } = experiencesObject[experienceKey];

            const idFix = id - 1;

            gameImage.classList.add('game-image');
            gameImage.src = picture;

            gameName.classList.add('game-name');
            gameName.innerHTML = name;

            gameDescription.classList.add('game-description');
            gameDescription.innerHTML = description;

            gameElement.classList.add('game');
            gameElement.setAttribute('game-id', id);
            gameElement.onclick = () => PlayGame(idFix);
            gameElement.appendChild(gameImage);
            gameElement.appendChild(gameName);
            gameElement.appendChild(gameDescription);

            experiencesElement.appendChild(gameElement);
        }
    }

    window.experiencesObject = experiencesObject;
});