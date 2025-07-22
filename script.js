document.addEventListener('DOMContentLoaded', () => {
    // --- PWA Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker registration failed:', err));
    }

    // --- DOM ELEMENT REFERENCES ---
    const mediaListEl = document.getElementById('media-list');
    const emptyStateEl = document.getElementById('empty-state');
    const addMediaButton = document.getElementById('add-media-button');
    const stopButton = document.getElementById('stop-button');
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
    const timeDisplay = document.getElementById('time-display');
    const timelineContainer = document.querySelector('.timeline-container');
    const timelineProgress = document.getElementById('timeline-progress');
    const fullscreenButton = document.getElementById('fullscreen-button');

    const nowPlayingBar = document.getElementById('now-playing-bar');
    const nowPlayingTitle = document.getElementById('now-playing-title');
    
    // Dialogs
    const confirmDialog = document.getElementById('confirm-dialog');
    const confirmTitle = document.getElementById('confirm-title');
    const confirmOkButton = document.getElementById('confirm-ok-button');
    const confirmCancelButton = document.getElementById('confirm-cancel-button');

    // --- STATE VARIABLES ---
    let db;
    let currentFileForThumbnail = null;
    let controlsTimeout;
    let isScrubbing = false;
    let wasPlayingBeforeScrub = false;
    let pressTimer = null;
    let currentlyPlayingId = null; // To track the current song for autoplay

    // --- DATABASE LOGIC ---
    const dbName = 'MomsMediaPlayerDB';
    const storeName = 'mediaFiles';

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 2);
            request.onerror = (e) => reject('DB Error');
            request.onupgradeneeded = (e) => {
                const dbInstance = e.target.result;
                if (!dbInstance.objectStoreNames.contains(storeName)) {
                    dbInstance.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                }
            };
            request.onsuccess = (e) => {
                db = e.target.result;
                resolve();
            };
        });
    }

    // --- MEDIA & UI FUNCTIONS ---

    async function loadMediaFromDB() {
        if (!db) return;
        const transaction = db.transaction([storeName], 'readonly');
        transaction.objectStore(storeName).getAll().onsuccess = (e) => {
            renderMediaList(e.target.result);
        };
    }
    
    function renderMediaList(files) {
        mediaListEl.innerHTML = '';
        emptyStateEl.classList.toggle('hidden', files.length > 0);

        files.forEach(fileData => {
            const isVideo = fileData.type.startsWith('video/');
            const li = document.createElement('li');
            li.dataset.id = fileData.id;

            const thumbnailStyle = fileData.thumbnailURL ? `background-image: url('${fileData.thumbnailURL}')` : '';
            
            li.innerHTML = `
                <div class="list-thumbnail" style="${thumbnailStyle}">
                    ${!fileData.thumbnailURL ? `<i class="fas ${isVideo ? 'fa-film' : 'fa-music'} text-3xl text-gray-500"></i>` : ''}
                </div>
                <div class="list-info">
                    <div>
                        <p class="title">${fileData.name}</p>
                        <p class="subtitle">${fileData.type}</p>
                    </div>
                    <div class="actions">
                        <button title="Set custom thumbnail" class="thumbnail-button p-2 text-gray-400 hover:text-blue-400">
                            <i class="fas fa-image"></i>
                        </button>
                    </div>
                </div>
            `;
            mediaListEl.appendChild(li);
        });
    }

    function addFilesToDB(files) {
        if (!db) return;
        const transaction = db.transaction([storeName], 'readwrite');
        transaction.oncomplete = loadMediaFromDB;
        for (const file of files) {
            transaction.objectStore(storeName).add({
                name: file.name, type: file.type, data: file, thumbnailURL: null
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
        const request = transaction.objectStore(storeName).get(id);
        request.onsuccess = () => {
            const data = request.result;
            data.thumbnailURL = thumbnailURL;
            transaction.objectStore(storeName).put(data).onsuccess = loadMediaFromDB;
        };
    }
    
    function showConfirmation(title, onConfirm) {
        confirmTitle.textContent = title;
        confirmDialog.classList.remove('hidden');
        
        const newOkButton = confirmOkButton.cloneNode(true);
        confirmOkButton.parentNode.replaceChild(newOkButton, confirmOkButton);
        
        newOkButton.addEventListener('click', () => {
            onConfirm();
            confirmDialog.classList.add('hidden');
        });
    }
    confirmCancelButton.addEventListener('click', () => confirmDialog.classList.add('hidden'));

    // --- PLAYER LOGIC ---

    function playMedia(id) {
        currentlyPlayingId = id; // Set the currently playing ID
        const transaction = db.transaction([storeName], 'readonly');
        const request = transaction.objectStore(storeName).get(id);
        request.onsuccess = () => {
            const fileData = request.result;
            if (!fileData) return;
            const url = URL.createObjectURL(fileData.data);
            nowPlayingTitle.textContent = fileData.name;
            nowPlayingBar.classList.remove('hidden');
            stopButton.classList.remove('hidden');
            videoPlayer.pause(); audioPlayer.pause();
            videoPlayer.src = ''; audioPlayer.src = '';
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
    
    // --- UPDATED: AUTOPLAY NEXT FUNCTION WITH LOOPING ---
    function playNext() {
        if (currentlyPlayingId === null) return;

        const allMediaItems = Array.from(mediaListEl.querySelectorAll('li[data-id]'));
        if (allMediaItems.length === 0) {
            stopPlayback();
            return;
        }
        
        const currentIndex = allMediaItems.findIndex(item => parseInt(item.dataset.id) === currentlyPlayingId);
        let nextIndex;

        if (currentIndex > -1 && currentIndex < allMediaItems.length - 1) {
            // If there is a next song in the list, get its index
            nextIndex = currentIndex + 1;
        } else {
            // Otherwise, it's the end of the list, so loop back to the beginning
            nextIndex = 0;
        }
        
        const nextItem = allMediaItems[nextIndex];
        const nextId = parseInt(nextItem.dataset.id);
        playMedia(nextId);
    }

    function stopPlayback() {
        videoPlayer.pause(); audioPlayer.pause();
        if (videoPlayer.src) URL.revokeObjectURL(videoPlayer.src);
        if (audioPlayer.src) URL.revokeObjectURL(audioPlayer.src);
        videoPlayer.src = ''; audioPlayer.src = ''; videoPlayer.poster = '';
        playerSection.classList.add('hidden');
        nowPlayingBar.classList.add('hidden');
        stopButton.classList.add('hidden');
        currentlyPlayingId = null; // Reset tracker
    }

    function togglePlayPause() {
        const player = videoPlayer.src ? videoPlayer : audioPlayer;
        if (player.paused) player.play(); else player.pause();
    }

    function updatePlayPauseUI(isPlaying) {
        videoContainer.classList.toggle('playing', isPlaying);
        playPauseButton.querySelector('i').className = `fas ${isPlaying ? 'fa-pause' : 'fa-play'}`;
    }

    function formatTime(time) {
        const min = Math.floor(time / 60);
        const sec = Math.floor(time % 60);
        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    function handleTimeUpdate() {
        if (isScrubbing) return;
        const player = videoPlayer.src ? videoPlayer : audioPlayer;
        timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration || 0)}`;
        timelineProgress.style.width = `${(player.currentTime / player.duration) * 100}%`;
    }

    function handleTimelineInteraction(e) {
        const player = videoPlayer.src ? videoPlayer : audioPlayer;
        if (!player.duration) return;
        const timelineBounds = timelineContainer.getBoundingClientRect();
        const clientX = e.clientX ?? e.targetTouches[0].clientX;
        let seekRatio = Math.max(0, Math.min(1, (clientX - timelineBounds.left) / timelineBounds.width));
        player.currentTime = seekRatio * player.duration;
        timelineProgress.style.width = `${seekRatio * 100}%`;
    }

    // --- EVENT LISTENERS ---

    addMediaButton.addEventListener('click', () => mediaFileInput.click());
    stopButton.addEventListener('click', stopPlayback);
    mediaFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) addFilesToDB(e.target.files);
        e.target.value = '';
    });
    thumbnailFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && currentFileForThumbnail !== null) {
            const reader = new FileReader();
            reader.onload = (event) => setThumbnail(currentFileForThumbnail, event.target.result);
            reader.readAsDataURL(file);
        }
        e.target.value = '';
    });

    mediaListEl.addEventListener('pointerdown', (e) => {
        const li = e.target.closest('li[data-id]');
        if (!li) return;
        if (e.target.closest('.thumbnail-button')) {
            e.stopPropagation();
            currentFileForThumbnail = parseInt(li.dataset.id);
            thumbnailFileInput.click();
            return;
        }
        pressTimer = setTimeout(() => {
            showConfirmation(`Delete "${li.querySelector('.title').textContent}"?`, () => {
                deleteMedia(parseInt(li.dataset.id));
            });
        }, 750);
    });
    mediaListEl.addEventListener('pointerup', () => clearTimeout(pressTimer));
    mediaListEl.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    mediaListEl.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-id]');
        if (li && !e.target.closest('button')) {
            playMedia(parseInt(li.dataset.id));
        }
    });

    videoPlayer.addEventListener('play', () => updatePlayPauseUI(true));
    videoPlayer.addEventListener('pause', () => updatePlayPauseUI(false));
    videoPlayer.addEventListener('timeupdate', handleTimeUpdate);
    videoPlayer.addEventListener('loadedmetadata', handleTimeUpdate);
    videoPlayer.addEventListener('ended', playNext); // Autoplay listener
    audioPlayer.addEventListener('play', () => updatePlayPauseUI(true));
    audioPlayer.addEventListener('pause', () => updatePlayPauseUI(false));
    audioPlayer.addEventListener('timeupdate', handleTimeUpdate);
    audioPlayer.addEventListener('loadedmetadata', handleTimeUpdate);
    audioPlayer.addEventListener('ended', playNext); // Autoplay listener

    playPauseButton.addEventListener('click', togglePlayPause);
    bigPlayButton.addEventListener('click', togglePlayPause);
    fullscreenButton.addEventListener('click', () => videoContainer.requestFullscreen());
    timelineContainer.addEventListener('pointerdown', (e) => {
        isScrubbing = true;
        wasPlayingBeforeScrub = !videoPlayer.paused || !audioPlayer.paused;
        videoPlayer.pause(); audioPlayer.pause();
        handleTimelineInteraction(e);
    });
    document.addEventListener('pointermove', (e) => {
        if (isScrubbing) handleTimelineInteraction(e);
    });
    document.addEventListener('pointerup', () => {
        if (isScrubbing) {
            isScrubbing = false;
            if (wasPlayingBeforeScrub) (videoPlayer.src ? videoPlayer : audioPlayer).play();
        }
    });
    
    initDB().then(loadMediaFromDB).catch(err => console.error("Initialization failed:", err));
});
