// Script initialization and logging to indicate the script has started executing.
console.log("Script is running")
// Configuration for the application debug mode. Set to true to enable debugging.
const config = {
  debugMode: true, // Toggle this as needed
};

// Spotify API Configuration
const clientId = 'be17a6b56e6c42dc8fd8aadbe1b62ac8';
const clientSecret = '35da63fe5f96466a9cab8e3736a8c3ad';
const redirectUrl = 'http://localhost:3000';
const authorizationEndpoint = "https://accounts.spotify.com/authorize";
const tokenEndpoint = "https://accounts.spotify.com/api/token";
const scope = 'user-read-private user-read-email user-modify-playback-state user-read-playback-state streaming user-read-currently-playing';

// Variables for player state
let player;
let isPlaying = false;
let playerReadyPromise;
let firstTrackUri;
let playlistUri;
let listenerAttached = false;
let lastVolume = 50;
let isLast = false;
let animationFrameRequest = null;
let currentState = {
  totalIndex:0, // Array of Spotify track URIs
  currentIndex: 0, // Index of the currently playing track in the playlist
};

const volumeBar = document.getElementById('volume-bar');
const volumeIcon = document.getElementById('volume-icon');
const volumeRange = document.getElementById('volume-range');
const seekbar = document.getElementById('seekip');
let volumeLevel = volumeRange.value;

// Data structure that manages the current active token, caching it in localStorage
let token = '';
const currentToken = {
    get access_token() { return localStorage.getItem('access_token') || null; },
    get refresh_token() { return localStorage.getItem('refresh_token') || null; },
    get expires_in() { return localStorage.getItem('expires_in') || null },
    get expires() { return localStorage.getItem('expires') || null },
    get token_type() { return localStorage.getItem('token_type') || null },

    save: function (response) {
    // Save token information to localStorag    
    const { access_token, refresh_token, expires_in } = response;
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
    localStorage.setItem('expires_in', expires_in);
    const now = new Date();
    const expiry = new Date(now.getTime() + (expires_in * 1000));
    localStorage.setItem('expires', expiry);
    },

    clear: function() {
      // Clear token information from localStorage
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('expires_in');
      localStorage.removeItem('expires');
      localStorage.setItem('token_type', 1);
    }
};

// Function to redirect to Spotify's authorization page
async function redirectToSpotifyAuthorize() {

    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomValues = crypto.getRandomValues(new Uint8Array(64));
    const randomString = randomValues.reduce((acc, x) => acc + possible[x % possible.length], "");
    const code_verifier = randomString;
    const data = new TextEncoder().encode(code_verifier);
    const hashed = await crypto.subtle.digest('SHA-256', data);
    const code_challenge_base64 = btoa(String.fromCharCode(...new Uint8Array(hashed)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    window.localStorage.setItem('code_verifier', code_verifier);
    const authUrl = new URL(authorizationEndpoint)
    const params = {
      response_type: 'code',
      client_id: clientId,
      scope: scope,
      code_challenge_method: 'S256',
      code_challenge: code_challenge_base64,
      redirect_uri: redirectUrl,
    };
    localStorage.setItem('token_type',2);
    authUrl.search = new URLSearchParams(params).toString();
    window.location.href = authUrl.toString(); // Redirect the user to the authorization server for login
}

// Function to schedule the refresh of the access token
function scheduleTokenRefresh() {
  if (!currentToken.expires_in || !currentToken.refresh_token) {
      console.error('No refresh token or expiration information available.');
      return;
  }

  // Calculate the delay until the token needs to be refreshed.
  // Subtracting a small margin (e.g., 1 minute) to ensure the token is refreshed before it actually expires.
  const expiresInMs = currentToken.expires_in * 1000; // Convert expiresIn to milliseconds
  const refreshMargin = 60 * 1000; // 1 minute margin
  const delay = expiresInMs - refreshMargin;

  setTimeout(async () => {
      try {
          const refreshedToken = await refreshToken(); // Assume this function refreshes the token and returns the new token data
          console.log('Token refreshed successfully.');

          // Save the new token information (this part depends on how you're storing the token)
          currentToken.access_token = refreshedToken.access_token;
          currentToken.expires_in = refreshedToken.expires_in;

          // Update the expiration time based on the new token's expiresIn
          const now = new Date();
          const expiry = new Date(now.getTime() + refreshedToken.expires_in * 1000);
          localStorage.setItem('expires', expiry);

          // Schedule the next token refresh
          scheduleTokenRefresh();
      } catch (error) {
          console.error('Failed to refresh token:', error);
          // Handle the failure (e.g., by retrying after a delay or logging the user out)
      }
  }, delay);
} 

// Functions for Spotify API calls: fetchSpotifyToken, refreshToken, fetchArtistInformation, etc.
async function fetchSpotifyToken(code) {
    const code_verifier = localStorage.getItem('code_verifier');

    // Encode clientId and clientSecret to base64 using btoa
    const base64Credentials = btoa(clientId + ':' + clientSecret);

    const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Use the encoded credentials
            'Authorization': 'Basic ' + base64Credentials
        },
        // Change 'form' to 'body' and ensure it's a string
        body: new URLSearchParams({
            code: code,
            redirect_uri: redirectUrl,
            grant_type: 'authorization_code',
            code_verifier: code_verifier,
        }).toString(),
    });

    const data = await response.json();
    if (data.access_token && data.expires_in) {
      // Save the token and expiration info, then schedule a refresh
      currentToken.save(data); // Assuming this method saves the token and sets up expiration correctly
      scheduleTokenRefresh();
   }
   localStorage.setItem('token_type', 2);
    return data;
}
 
async function refreshToken(retryCount = 1) {
  let attempts = 0;
  while (attempts < retryCount) {
      try {
          const response = await fetch('https://accounts.spotify.com/api/token', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret),
              },
              body: new URLSearchParams({
                  grant_type: 'refresh_token',
                  refresh_token: currentToken.refresh_token,
              }),
          });

          if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = await response.json();
          localStorage.setItem('token_type', currentToken.token_type);
          console.log('Token refreshed successfully', data);

          // Save the new access token and update the expiration time accordingly
          currentToken.save({
              access_token: data.access_token,
              expires_in: data.expires_in,
          });

          scheduleTokenRefresh();
          return; // Exit the function upon successful refresh
      } catch (error) {
          console.error(`Failed to refresh token on attempt ${attempts + 1}:`, error);
          attempts++;
          if (attempts < retryCount) {
              // Wait for 2 seconds before retrying
              await new Promise(resolve => setTimeout(resolve, 2000));
          }
      }
  }

  // If all attempts fail, clear the current token and redirect to authorization
  console.error('All attempts to refresh the token have failed. Clearing token and redirecting to login.');
  currentToken.clear(); // Clear the token data. Implement this method to remove token data from storage.
  redirectToSpotifyAuthorize(); // Redirect to Spotify's authorization flow
}

//for initial loading of playlist and track use this as these calls doesn't require user authorzation
async function fetchSpotifyToken1() {
    try {

        const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`
        });
        const data = await response.json();
        if (data.access_token && data.expires_in) {
          // Save the token and expiration info, then schedule a refresh
          currentToken.save(data); // Assuming this method saves the token and sets up expiration correctly
          scheduleTokenRefresh();
       }
       localStorage.setItem('token_type', 1);
        return data;
      } catch (error) {
        console.error('Error:', error);
      }
}

async function getProfile() {
    const response = await fetch("https://api.spotify.com/v1/me", {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + currentToken.access_token },
    });

    const data =  await response.json();
    document.querySelector(".userlog").innerHTML = '';
    document.querySelector(".userlog").innerHTML = '<p class="colorwht">'+data.display_name+'</p>';
}

async function fetchArtistInformation() {
    try {
      
      const accessToken = currentToken.access_token;
  
      const artistResponse = await fetch("https://api.spotify.com/v1/artists/4Z8W4fKeB5YxbusRsdQVPb", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`
        }
      });
  
      const artistData = await artistResponse.json();
      console.log(artistData); // Logs the artist information
    } catch (error) {
      console.error('Error:', error);
    }
}
  
async function fetchFeaturedPlaylists(limit) {
    try {
      const accessToken = currentToken.access_token;
      const response = await fetch('https://api.spotify.com/v1/browse/featured-playlists?limit='+limit, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
  
      const data = await response.json();
      const playlists = data.playlists.items;
      //console.log(playlists);
      let htmlContent = '';
  
      playlists.forEach(playlist => {
        const { name, description, images, id } = playlist;
        const imageUrl = images[0].url; // Assuming the first image is the one you want to display
  
        htmlContent += `
          <div class="playcard rounded10 m10 p15 bg-lblack" data-playlist-id="${id}">
            <div class="pcthumb">
              <img class="rounded10" src="${imageUrl}" alt="playlist banner">
              <div class="playbtn">
                <i class="fa-solid fa-play"></i>    
              </div>
            </div>
            <h2 class="whtcolor mt15">${name}</h2>
            <p class="greycolor mt10 mr5">${description || 'No description available'}</p>
          </div>
        `;
      });
      displayPlaylistTracks(playlists[0].id);
      document.getElementById('playlistsContainer').innerHTML = htmlContent;
      // Add event listener to the container, delegating to the playcards
        document.getElementById('playlistsContainer').addEventListener('click', function(e) {
            const playcard = e.target.closest('.playcard');
            if (playcard) {
            const playlistId = playcard.getAttribute('data-playlist-id');
            if (playlistId) {
                displayPlaylistTracks(playlistId);
            }
            }
        });
    } catch (error) {
      await fetchSpotifyToken1();
      await fetchFeaturedPlaylists(25);
    }
}

async function fetchPlaylistTracks(playlistId) {
    try {
      const accessToken = currentToken.access_token;
  
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
  
      const data = await response.json();
      //console.log(data);
      return data.items;
    } catch (error) {
      console.error('Error fetching playlist tracks:', error);
    }
}

function displayTracks(trackItems, playlistUri) {
  const tracksContainer = document.getElementById('tracksContainer');
  if (!tracksContainer) return;

  let htmlContent = '';
  currentState.totalIndex =  trackItems.length;
  trackItems.forEach((item, index) => {
      const { uri, name, album, artists } = item.track;
      const imageUrl = album && album.images.length > 0 ? album.images[0].url : 'path/to/default/image.jpg';
      let artistsHtml = artists.map(artist => `<span data-artist-id="${artist.id}" title="${artist.name}">${artist.name}</span>`).join(', ');

      // Include playlistUri and track index in dataset for playback
      htmlContent += `
        <li data-uri="${uri}" data-playlist-uri="${playlistUri}" data-track-index="${index}" class="playlcard pointer bg-dgrey flex p10 mt10 rounded10">
          <div class="playthumb"><img src="${imageUrl}" alt="${name}"></div>
          <div class="playldet ml20">
            <h3 title="${name}">${name}</h3>
            <p class="mr5 mt5">${artistsHtml}</p>
          </div>
        </li>
      `;
  });

  tracksContainer.innerHTML = htmlContent;
  displayTrackInfo(trackItems[0].track.uri);
  attachEventListenerToTracksContainer();
}

function attachEventListenerToTracksContainer() {
  if (listenerAttached) return;
  const tracksContainer = document.getElementById('tracksContainer');
  tracksContainer.addEventListener('click', async function(e) {
      const trackItem = e.target.closest('.playlcard');
      if (trackItem) {
          const spotifyUri = trackItem.getAttribute('data-uri');
          const playlistUri = trackItem.getAttribute('data-playlist-uri');
          const trackIndex = trackItem.getAttribute('data-track-index');
          e.preventDefault();
          await playerReadyPromise;
          if (!player || !window.device_id) {
            openPopup();
          }else{
            await playContent(spotifyUri, playlistUri, trackIndex);
          }
        
      }
  });
  listenerAttached = true;
}

async function displayPlaylistTracks(playlistId) {
  try {
      const tracks = await fetchPlaylistTracks(playlistId);
      // Construct the Spotify URI for the playlist
      playlistUri = `spotify:playlist:${playlistId}`;
      // Pass both the tracks and the playlistUri to displayTracks
      displayTracks(tracks, playlistUri);
      await playerReadyPromise;
      if (tracks && tracks.length > 0) {
        firstTrackUri = tracks[0].track.uri;
        //playContent(firstTrackUri, playlistUri, 0, true);
    }
  } catch (error) {
      console.error('Error displaying playlist tracks:', error);
  }
}

function hasValidToken() {
  const expires = localStorage.getItem('expires');
  if (!expires) {
      // If there's no expiration time stored, the token is considered invalid.
      console.debug('No token expiration time found.');
      return false;
  }

  const now = new Date();
  const expiryTime = new Date(expires);

  // Introduce a grace period (e.g., 5 minutes) to ensure the token is refreshed before it technically expires.
  const gracePeriod = 5 * 60 * 1000; // 5 minutes in milliseconds
  const isTokenValid = now.getTime() + gracePeriod < expiryTime.getTime();

  // Conditional logging based on a debug flag or environment variable
  if (config.debugMode) {
      console.debug(`Token validity check: ${isTokenValid}. Current time: ${now}, Token expiration time: ${expiryTime}`);
  }

  return isTokenValid;
}

async function fetchTrackDetails(spotifyUri) {
    const accessToken = currentToken.access_token ; // Replace with your actual access token
    // Extract the track ID from the URI
    const trackId = spotifyUri.split(':')[2];
    
    try {
      const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
  
      if (!response.ok) {
        throw new Error('Failed to fetch track details');
      }
  
      const trackDetails = await response.json();
      return trackDetails; // Return the track details for further processing
    } catch (error) {
      console.error('Error fetching track details:', error);
    }
}

function updatePlaybar(trackDetails) {
  const songName = trackDetails.name;
  const songImage = trackDetails.album.images[0].url; // Assuming the first image is what you want to display
  const artistNames = trackDetails.artists.map(artist => `<span>${artist.name}</span>`).join(', ');

  const playbarContent = `
      <div class="playlcard flex p10 rounded10">
          <div class="playthumb"><img src="${songImage}" /></div>
          <div class="playldet ml20">
              <h3 title="${songName}">${songName}</h3>
              <p class="mr5 mt5">${artistNames}</p>
          </div>
      </div>`;

  document.querySelector(".songname").innerHTML = playbarContent;
  document.querySelector(".inittime").innerHTML = "00:00";
  document.querySelector(".sttime").innerHTML = "00:00";
}

async function displayTrackInfo(spotifyUri) {
  try {
      const trackDetails = await fetchTrackDetails(spotifyUri);
      if (trackDetails) {
          updatePlaybar(trackDetails);
      }
  } catch (error) {
      console.error('Error displaying track info:', error);
  }
}

function initializeSpotifyPlayer(token) {
  // Initialize the promise
  playerReadyPromise = new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = () => {
          player = new Spotify.Player({
              name: "Web Playback SDK",
              getOAuthToken: cb => cb(token),
              volume: 0.5
          });

          player.connect().then(success => {
            if (success) {
                console.log("The Web Playback SDK successfully connected to Spotify!");
            } else {
                console.log("Failed to connect the Web Playback SDK to Spotify.");
            }
        });

          player.addListener('ready', ({ device_id: deviceId }) => {
              console.log(`Ready with Device ID ${deviceId}`);
              window.device_id = deviceId; // Store the device ID globally
              resolve(player);  
          });

          player.addListener('not_ready', ({ device_id: deviceId }) => {
              console.log(`Device ID has gone offline ${deviceId}`);
              reject(new Error(`Player with Device ID ${deviceId} has gone offline`));
          });
      };

      // Load the Spotify Playback SDK script
      loadSpotifyPlaybackSDK();
  });
}

function loadSpotifyPlaybackSDK() {
  if (window.Spotify) {
      console.log("Spotify SDK already loaded.");
      return; // If the SDK is already loaded, no need to load it again
  }
  const script = document.createElement("script");
  script.src = "https://sdk.scdn.co/spotify-player.js";
  script.async = true;
  document.body.appendChild(script);
}

async function playContent(spotifyUri, playlistUri = null, trackIndex = null, pause = false) {
  await playerReadyPromise;
  if (!player || !window.device_id) {
    console.error('Spotify Player is not initialized or device ID is missing.');
    return;
  } 
  displayTrackInfo(spotifyUri);
  currentState.currentIndex = parseInt(trackIndex);
  if (pause) {
      return; // Exit if pausing
  }
  
  let requestBody = {};

  // Determine whether to use context_uri or uris
  if (playlistUri) {
      requestBody.context_uri = playlistUri; // Use context_uri for playlists and albums
      if (trackIndex !== null) {
          requestBody.offset = { position: parseInt(trackIndex) }; // Optionally specify track index for playlists
      }
  } else if (spotifyUri) {
      requestBody.uris = [spotifyUri]; // Use uris for individual tracks
  }

  try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${window.device_id}`, {
          method: 'PUT',
          body: JSON.stringify(requestBody),
          headers: {
              'Authorization': `Bearer ${currentToken.access_token}`,
              'Content-Type': 'application/json',
          },
      });
      isPlaying = true;
      startUpdatingSeekbar();
      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }
      play.classList.remove("fa-circle-play");
      play.classList.add("fa-circle-pause");
      console.log('Playback started successfully.');
  } catch (error) {
      console.error('Failed to start playback:', error);
  }
}

async function skipToNextTrack() {
  if(isLast){
    playContent(firstTrackUri, playlistUri, 0, false);
    isLast = false;
    return;
    
  }
  currentState.currentIndex = parseInt(currentState.currentIndex)+1;
  let element = document.querySelector(`[data-track-index="${currentState.currentIndex}"]`);
  let dataUri = element.getAttribute('data-uri');
  displayTrackInfo(dataUri);
  if((currentState.totalIndex-currentState.currentIndex)==1){
    isLast = true;
  }
  try {
      const response = await fetch('https://api.spotify.com/v1/me/player/next', {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${currentToken.access_token}`
          }
      });
      if (response.ok) {
          isPlaying = true;
          startUpdatingSeekbar();
          console.log('Successfully skipped to the next track.');
      } else {
          console.error('Failed to skip to the next track.');
      }
  } catch (err) {
      console.error('Error skipping to the next track:', err);
  }
}

async function skipToPreviousTrack() {
  if(currentState.currentIndex == 0){
    return;
  }
  currentState.currentIndex = parseInt(currentState.currentIndex)-1;
  let element = document.querySelector(`[data-track-index="${currentState.currentIndex}"]`);
  let dataUri = element.getAttribute('data-uri');
  displayTrackInfo(dataUri);
  try {
      const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${currentToken.access_token}`
          }
      });
      if (response.ok) {
          isPlaying = true;
          startUpdatingSeekbar();
          console.log('Successfully skipped to the previous track.');
      } else {
          console.error('Failed to skip to the previous track.');
      }
  } catch (err) {
      console.error('Error skipping to the previous track:', err);
  }
}

async function setSpotifyVolume(device_id) {
  const volumePercent = volumeRange.value; // Get the current value of the input range
  if (volumePercent == 0) {
    volumeIcon.innerHTML = '<i class="fa-solid fa-volume-off blkcolor"></i>';
  } else if (volumePercent < 50) {
    volumeIcon.innerHTML = '<i class="fa-solid fa-volume-low blkcolor"></i>';
  } else {
    volumeIcon.innerHTML = '<i class="fa-solid fa-volume-high blkcolor"></i>';
  }
  volumeRange.style.background = `linear-gradient(to right, #242424 ${(volumePercent )}%, #A7A7A7 ${volumePercent }%)`;

  try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volumePercent}&device_id=${device_id}`, {
          method: 'PUT',
          headers: {
              'Authorization': `Bearer ${currentToken.access_token}`, // Use the current access token
              'Content-Type': 'application/json'
          }
      });

      if (response.ok) {
          console.log(`Volume set to ${volumePercent}%`);
      } else {
          console.error('Failed to set volume', response);
      }
  } catch (error) {
      console.error('Error setting volume:', error);
  }
}

async function fetchCurrentlyPlaying() {
  try {
      const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
          method: 'GET',
          headers: {
              'Authorization': `Bearer ${currentToken.access_token}`, // Ensure your access token is valid
              'Content-Type': 'application/json'
          }
      });

      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Check if the response has content before parsing
      if (response.status === 204) {
          //console.log("No content, likely no active playback.");
          return null;
      }

      const data = await response.json(); // Now safe to parse JSON
      if (data && data.item && data.progress_ms != null) {
          return {
              duration_ms: data.item.duration_ms,
              progress_ms: data.progress_ms
          };
      } else {
          return null; // No track is currently playing or missing expected data
      }
  } catch (error) {
      console.error('Error fetching currently playing track:', error);
      return null;
  }
}

function updateSeekbar() {
  fetchCurrentlyPlaying().then(playbackInfo => {
      if (playbackInfo) {
          
          const positionPercentage = (playbackInfo.progress_ms / playbackInfo.duration_ms) * 100;
          seekbar.style.background = `linear-gradient(to right, #242424 ${(positionPercentage)}%, #A7A7A7 ${positionPercentage}%)`;
          seekbar.value = playbackInfo.progress_ms;
          seekbar.max = playbackInfo.duration_ms;
          // Update current time and duration
          const currentTimeSpan = document.querySelector('.inittime');
          const durationSpan = document.querySelector('.sttime');
          currentTimeSpan.textContent = formatTime(playbackInfo.progress_ms);
          durationSpan.textContent = formatTime(playbackInfo.duration_ms);
          
          // Check if the song has nearly ended (e.g., within the last second)
          const hasSongEnded = playbackInfo.progress_ms >= (playbackInfo.duration_ms - 1000);

          if (!hasSongEnded) {
              // Continue updating if the song hasn't ended
              animationFrameRequest = window.requestAnimationFrame(updateSeekbar);
          } else {
              // Optionally, handle the end of the song (e.g., loading the next song or resetting the seekbar)
              console.log("Song has ended or is about to end.");
              seekbar.value = 0; 
              seekbar.style.background = `linear-gradient(to right, #242424 0%, #A7A7A7 0%)`;
              skipToNextTrack();// Reset the seekbar for the next song or to indicate the end
              // No further requestAnimationFrame calls here; the loop stops until explicitly restarted
          }
      } else {
          // No currently playing track was fetched; potentially stopped or paused
          //console.log("No currently playing track info available.");
          // You might want to reset the seekbar or handle this scenario based on your app's needs
          //seekbar.value = 0; // Example: Reset the seekbar
          // Consider whether you want to stop or continue the update loop in this case
          animationFrameRequest = window.requestAnimationFrame(updateSeekbar);
      }
  }).catch(error => {
      console.error("Failed to fetch currently playing track:", error);
      // Handle errors, potentially stopping the loop or taking other actions
  });
}

function startUpdatingSeekbar() {
  // Start or restart the update loop
  if (animationFrameRequest) {
      // If there's an existing loop, cancel it first to avoid duplicates
      cancelAnimationFrame(animationFrameRequest);
  }
  animationFrameRequest = window.requestAnimationFrame(updateSeekbar);
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // Format as HH:MM:SS if there are hours, otherwise MM:SS
  if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

async function playMusic(device_id) {
  //playContent(firstTrackUri, playlistUri, 0, true);
  const response = await fetch('https://api.spotify.com/v1/me/player/play?device_id=' + device_id, {
      method: 'PUT',
      headers: {
          'Authorization': `Bearer ${currentToken.access_token}`,
          'Content-Type': 'application/json'
      },
  });

  if (response.ok) {
      console.log("Playback started");
  } else {
    playContent(firstTrackUri, playlistUri, 0, false);
  }
}

async function pauseMusic(device_id) {
  const response = await fetch('https://api.spotify.com/v1/me/player/pause?device_id=' + device_id, {
      method: 'PUT',
      headers: {
          'Authorization': `Bearer ${currentToken.access_token}`,
          'Content-Type': 'application/json'
      }
  });

  if (response.ok) {
      console.log("Playback paused");
  } else {
      console.error("Failed to pause playback", response);
  }
}

function seekToPositionInSpotifyTrack(accessToken, seekbarValue) {
  const positionMs = parseInt(seekbarValue) ; // Convert percent to milliseconds assuming a 100 second long track for simplicity
  
  fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}` // Use the actual access token here
    },
  })
  .then(response => {
    if (response.ok) {
      console.log(`Seeked to ${positionMs} milliseconds in the track.`);
    } else {
      console.error('Failed to seek in Spotify track.', response);
    }
  })
  .catch(error => console.error('Error seeking in Spotify track:', error));
}

function setupUIEventListeners(){
  document.querySelector(".hamburger").addEventListener("click", ()=>{
    document.querySelector(".leftsec").style.left = "0px";
  })

  document.querySelector(".hamclose").addEventListener("click", ()=>{
      document.querySelector(".leftsec").style.left = "-295px";
  })

  document.getElementById('loginbtn').addEventListener('click', async () => {
    if(currentToken.token_type==1){
      console.log(currentToken.token_type);
      currentToken.clear(); 
      redirectToSpotifyAuthorize();
      
    }else{
      console.log(currentToken.token_type);
      await initializeApplication();
    }
  })

  play.addEventListener('click', async () => {
    const deviceId = window.device_id; // Ensure you have the correct device ID
    if(deviceId){
      if (isPlaying) {
        await pauseMusic(deviceId);
        play.classList.remove("fa-circle-pause");
        play.classList.add("fa-circle-play");
        
      } else {
          await playMusic(deviceId);
          play.classList.remove("fa-circle-play");
          play.classList.add("fa-circle-pause");
      }
    }else{
      currentToken.clear(); 
      redirectToSpotifyAuthorize();
    }
    

    isPlaying = !isPlaying; // Toggle the state
  });
  
  // next button event listner
  next.addEventListener("click", () => {
      skipToNextTrack();
  });

  previous.addEventListener("click", () => {
      skipToPreviousTrack();
  });

  volumeRange.addEventListener('input', () => {
    const device_id = window.device_id;
    setSpotifyVolume(device_id);
  });

  volumeIcon.addEventListener('click', function() {
    const device_id = window.device_id;
    if(volumeRange.value != 0){
        lastVolume = volumeRange.value;
        volumeLevel = 0;
        volumeRange.value = 0;
        setSpotifyVolume(device_id);
    }else{
        volumeLevel = lastVolume;
        volumeRange.value = lastVolume;
        setSpotifyVolume(device_id);
    }
    
  });

 

// Listener for final action once dragging is complete
seekbar.addEventListener('input', function(e) {
        const seekbarValue = e.target.value;
        const seekbarMax = e.target.max;
        const accessToken = currentToken.access_token;
        const positionPercent= (seekbarValue / seekbarMax) * 100;
        seekbar.style.background = `linear-gradient(to right, #242424 ${(positionPercent)}%, #A7A7A7 ${positionPercent}%)`;
        seekToPositionInSpotifyTrack(accessToken, seekbarValue);
   // Delay to ensure it captures the final change event only
});

}

function openPopup() {
  document.getElementById("loginPopup").style.display = "block";
}

// When the user clicks on <span> (x), close the popup
function closePopup() {
    document.getElementById("loginPopup").style.display = "none";
}

async function initializeApplication() {
   // Setup UI event listeners.

  try {
      if (hasValidToken()) {
          // Load the Spotify Playback SDK and initialize the player
          loadSpotifyPlaybackSDK(); // This function now simply appends the SDK script
          initializeSpotifyPlayer(currentToken.access_token); // This initializes player and sets up playerReadyPromise
          
          // Wait for the player to be ready before proceeding
          await playerReadyPromise;
          scheduleTokenRefresh(); 
          getProfile();
          await fetchFeaturedPlaylists(25); // Fetch playlists or perform other operations that depend on the player being ready
      } else {
          const args = new URLSearchParams(window.location.search);
          const code = args.get('code');
          if (code) {
              // Handle authentication flow...
              const tokenData = await fetchSpotifyToken(code);
              currentToken.save(tokenData);
              // Remove code from URL so we can refresh correctly.
              const url = new URL(window.location.href);
              url.searchParams.delete("code");

              const updatedUrl = url.search ? url.href : url.href.replace('?', '');
              window.history.replaceState({}, document.title, updatedUrl);
              scheduleTokenRefresh();

              // Repeat the initialization steps as above
              loadSpotifyPlaybackSDK();
              initializeSpotifyPlayer(currentToken.access_token);
              getProfile() ;
              await playerReadyPromise;
              await fetchFeaturedPlaylists(25);
          } else if (currentToken.refresh_token) {
              // Handle token refresh flow...
              await refreshToken();
              loadSpotifyPlaybackSDK();
              initializeSpotifyPlayer(currentToken.access_token);
              getProfile() ;
              await playerReadyPromise;
              await fetchFeaturedPlaylists(25);
          } else {
              // No valid token and no authorization code, initiate authorization flow
              redirectToSpotifyAuthorize();
          }
      }
  } catch (error) {
      console.error("Initialization failed:", error);
      // Appropriate error handling here...
  }
}

async function main(){
    setupUIEventListeners();
    if(currentToken.token_type==1 || !currentToken.token_type){
      await fetchFeaturedPlaylists(25);
    }else{
      await initializeApplication();
    }
    // Get the <span> element that closes the popup
    var close = document.getElementsByClassName("close")[0];
    // When the user clicks on (x), close the popup
    close.onclick = function() {
        closePopup();
    }
    // Optional: Close the popup if the user clicks anywhere outside of it
    window.onclick = function(event) {
        var modal = document.getElementById("loginPopup");
        if (event.target == modal) {
            closePopup();
        }
    }
}

main();
