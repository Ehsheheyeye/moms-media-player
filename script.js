document.addEventListener('DOMContentLoaded', () => {
    // --- PWA Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => console.log('Service Worker registered successfully:', registration))
            .catch(error => console.log('Service Worker registration failed:', error));
    }

    // --- DOM ELEMENT REFERENCES ---
    const mediaListEl = document.getElementById('media-list');
    const emptyStateEl = document.getElementById('empty-state');
    const addMediaButton = document.getElementById('add-media-button');
    const mediaFileInput = document.getElementById('media-file-input');
    const thumbnailFileInput = document.getElementById('thumbnail-file-input');
    
    // Player elements
    const playerSection = document.getElementById('player-section');
    const videoContainer = document.getElementById('video-container');
    const videoPlayer = document.getElementById('video-player');
    const audioPlayer = document.getElementById('audio-player');
    
    // Controls
    const controlsContainer = document.getElementById('controls-container');
    const bigPlayButton = document.getElementById('big-play-button');
    const playPauseButton = document.getElementById('play-pause-button');
    const playPauseIcon = playPauseButton.querySelector('i');
    const timeDisplay = document.getElementById('time-display');
    const timelineContainer = document.querySelector('.timeline-container');
    const timelineProgress = document.getElementById('timeline-progress');
    const fullscreenButton = document.getElementById('fullscreen-button');
    const fullscreenIcon = fullscreenButton.querySelector('i');

    const nowPlayingBar = document.getElementById('now-playing-bar');
    const nowPlayingTitle = document.getElementById('now-playing-title');
    
    // Message Box
    const messageBox = document.getElementById('message-box');
    const messageText = document.getElementById('message-text');
    const messageOkButton = document.getElementById('message-ok-button');

    // --- STATE VARIABLES ---
    let db;
    let currentFileForThumbnail = null;
    let controlsTimeout;

    // --- DATABASE LOGIC ---
    const dbName = 'MomsMediaPlayerDB';
    const storeName = 'mediaFiles';

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 2); // Version 2 for thumbnail support

            request.onerror = (e) => {
                console.error('Database error:', e.target.error);
                showMessage('Error: Could not open the media database.');
                reject('DB Error');
            };

            request.onupgradeneeded = (e) => {
                const dbInstance = e.target.result;
                let objectStore;
                if (!dbInstance.objectStoreNames.contains(storeName)) {
                    objectStore = dbInstance.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                } else {
                    objectStore = e.target.transaction.objectStore(storeName);
                }
                // Add thumbnail field if it doesn't exist (for upgrades)
                if (!objectStore.indexNames.contains('thumbnailURL')) {
                     // We don't need an index, but this is a safe way to check for field existence conceptually
                }
            };

            request.onsuccess = (e) => {
                db = e.target.result;
                console.log('Database opened successfully.');
                resolve();
            };
        });
    }

    // --- MEDIA & UI FUNCTIONS ---

    async function loadMediaFromDB() {
        if (!db) return;
        const transaction = db.transaction([storeName], 'readonly');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.getAll();

        request.onsuccess = (e) => {
            renderMediaList(e.target.result);
        };
        request.onerror = (e) => console.error('Error fetching media:', e.target.error);
    }

    function renderMediaList(files) {
        mediaListEl.innerHTML = '';
        emptyStateEl.classList.toggle('hidden', files.length > 0);

        files.forEach(fileData => {
            const isVideo = fileData.type.startsWith('video/');
            const li = document.createElement('li');
            li.className = 'p-3 flex items-center hover:bg-gray-800 transition-colors duration-200';
            
            const thumbnailContent = fileData.thumbnailURL
                ? `<img src="${fileData.thumbnailURL}" class="w-16 h-10 object-cover bg-gray-700 rounded-md mr-4 flex-shrink-0">`
                : `<div class="w-16 h-10 bg-gray-700 rounded-md flex items-center justify-center mr-4 flex-shrink-0">
                       <i class="fas ${isVideo ? 'fa-film' : 'fa-music'} text-xl text-gray-400"></i>
                   </div>`;

            li.innerHTML = `
                ${thumbnailContent}
                <div class="flex-grow overflow-hidden cursor-pointer" data-id="${fileData.id}">
                    <p class="font-semibold truncate">${fileData.name}</p>
                    <p class="text-sm text-gray-400">${fileData.type}</p>
                </div>
                <button title="Set custom thumbnail" class="thumbnail-button ml-2 p-2 text-gray-500 hover:text-blue-400 flex-shrink-0" data-id="${fileData.id}">
                    <i class="fas fa-image"></i>
                </button>
                <button title="Delete file" class="delete-button ml-2 p-2 text-gray-500 hover:text-red-500 flex-shrink-0" data-id="${fileData.id}">
                    <i class="fas fa-trash-alt"></i>
                </button>
            `;
            
            mediaListEl.appendChild(li);
        });
    }

    function addFilesToDB(files) {
        if (!db) return;
        const transaction = db.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        
        transaction.oncomplete = () => {
            showMessage(`Added ${files.length} new file(s).`);
            loadMediaFromDB();
        };
        transaction.onerror = (e) => showMessage(`Error saving files: ${e.target.error.message}`);

        for (const file of files) {
            objectStore.add({
                name: file.name,
                type: file.type,
                data: file,
                thumbnailURL: null // Initialize thumbnail as null
            });
        }
    }
    
    function deleteMedia(id) {
        const transaction = db.transaction([storeName], 'readwrite');
        transaction.objectStore(storeName).delete(id);
        transaction.oncomplete = loadMediaFromDB;
    }

    function setThumbnail(id, thumbnailURL) {
        const transaction = db.transaction([storeName], 'readwrite');
        const objectStore = transaction.objectStore(storeName);
        const request = objectStore.get(id);

        request.onsuccess = () => {
            const data = request.result;
            data.thumbnailURL = thumbnailURL;
            const updateRequest = objectStore.put(data);
            updateRequest.onsuccess = loadMediaFromDB;
        };
    }

    function playMedia(id) {
        const transaction = db.transaction([storeName], 'readonly');
        const request = transaction.objectStore(storeName).get(id);

        request.onsuccess = () => {
            const fileData = request.result;
            if (!fileData) return;

            const url = URL.createObjectURL(fileData.data);
            nowPlayingTitle.textContent = fileData.name;
            nowPlayingBar.classList.remove('hidden');

            videoPlayer.pause();
            audioPlayer.pause();
            videoPlayer.src = '';
            audioPlayer.src = '';
            
            // Set poster for video
            videoPlayer.poster = fileData.thumbnailURL || '';

            if (fileData.type.startsWith('video/')) {
                playerSection.classList.remove('hidden');
                videoContainer.classList.remove('hidden');
                videoPlayer.src = url;
                videoPlayer.play();
            } else {
                videoContainer.classList.add('hidden');
                audioPlayer.src = url;
                audioPlayer.play();
            }
        };
    }

    // --- PLAYER CONTROL LOGIC ---

    function togglePlayPause() {
        const player = videoPlayer.src ? videoPlayer : audioPlayer;
        if (player.paused) {
            player.play();
        } else {
            player.pause();
        }
    }

    function updatePlayPauseUI(isPlaying) {
        videoContainer.classList.toggle('playing', isPlaying);
        const icon = isPlaying ? 'fa-pause' : 'fa-play';
        playPauseIcon.className = `fas ${icon}`;
        // Adjust big play button icon if needed
        bigPlayButton.querySelector('i').className = `fas fa-play ml-1`;
    }

    function formatTime(timeInSeconds) {
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = Math.floor(timeInSeconds % 60);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function handleTimeUpdate() {
        const player = videoPlayer.src ? videoPlayer : audioPlayer;
        const currentTime = player.currentTime;
        const duration = player.duration || 0;
        timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        timelineProgress.style.width = `${(currentTime / duration) * 100}%`;
    }

    function handleTimelineClick(e) {
        const timelineBounds = timelineContainer.getBoundingClientRect();
        const clickPosition = e.clientX - timelineBounds.left;
        const timelineWidth = timelineBounds.width;
        const seekRatio = clickPosition / timelineWidth;
        const player = videoPlayer.src ? videoPlayer : audioPlayer;
        player.currentTime = seekRatio * player.duration;
    }
    
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            videoContainer.requestFullscreen().catch(err => {
                showMessage(`Error entering fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    }
    
    function updateFullscreenUI() {
        const isFullscreen = !!document.fullscreenElement;
        fullscreenIcon.className = `fas ${isFullscreen ? 'fa-compress' : 'fa-expand'}`;
    }

    function showControls() {
        clearTimeout(controlsTimeout);
        controlsContainer.style.opacity = '1';
        controlsTimeout = setTimeout(() => {
            if (!videoPlayer.paused) {
                controlsContainer.style.opacity = '0';
            }
        }, 3000);
    }

    // --- EVENT LISTENERS ---
    addMediaButton.addEventListener('click', () => mediaFileInput.click());
    mediaFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) addFilesToDB(e.target.files);
        e.target.value = '';
    });

    mediaListEl.addEventListener('click', (e) => {
        const playTarget = e.target.closest('[data-id]:not(button)');
        const deleteBtn = e.target.closest('.delete-button');
        const thumbBtn = e.target.closest('.thumbnail-button');

        if (playTarget) playMedia(parseInt(playTarget.dataset.id));
        if (deleteBtn) deleteMedia(parseInt(deleteBtn.dataset.id));
        if (thumbBtn) {
            currentFileForThumbnail = parseInt(thumbBtn.dataset.id);
            thumbnailFileInput.click();
        }
    });

    thumbnailFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && currentFileForThumbnail !== null) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setThumbnail(currentFileForThumbnail, event.target.result);
            };
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    });
    
    // Player listeners
    videoPlayer.addEventListener('play', () => updatePlayPauseUI(true));
    videoPlayer.addEventListener('pause', () => updatePlayPauseUI(false));
    videoPlayer.addEventListener('timeupdate', handleTimeUpdate);
    videoPlayer.addEventListener('loadedmetadata', handleTimeUpdate); // Initial time display
    audioPlayer.addEventListener('play', () => updatePlayPauseUI(true));
    audioPlayer.addEventListener('pause', () => updatePlayPauseUI(false));
    audioPlayer.addEventListener('timeupdate', handleTimeUpdate);
    audioPlayer.addEventListener('loadedmetadata', handleTimeUpdate);

    // Controls listeners
    playPauseButton.addEventListener('click', togglePlayPause);
    bigPlayButton.addEventListener('click', togglePlayPause);
    timelineContainer.addEventListener('click', handleTimelineClick);
    fullscreenButton.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreenUI);

    // Controls visibility listeners
    videoContainer.addEventListener('mouseenter', showControls);
    videoContainer.addEventListener('mousemove', showControls);
    videoContainer.addEventListener('mouseleave', () => {
        clearTimeout(controlsTimeout);
        if (!videoPlayer.paused) {
            controlsContainer.style.opacity = '0';
        }
    });

    // Message Box
    messageOkButton.addEventListener('click', () => messageBox.classList.add('hidden'));
    function showMessage(text) {
        messageText.textContent = text;
        messageBox.classList.remove('hidden');
    }

    // --- INITIALIZATION ---
    initDB().then(loadMediaFromDB).catch(err => console.error("Initialization failed:", err));
});
