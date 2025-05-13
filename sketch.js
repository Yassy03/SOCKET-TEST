// script.js - Face-API.js with WebSocket for TouchDesigner Integration

let video;
let detections = [];
let canvas;
let socket;
let lastSentData = null; // Track last sent data to avoid redundant messages
let reconnectInterval;   // For handling reconnection attempts

// WebSocket setup with reconnection logic
function setupWebSocket() {
  // Close any existing connection
  if (socket) {
    socket.close();
  }
  
  console.log('Attempting to connect WebSocket...');
  socket = new WebSocket('ws://localhost:8080'); // TouchDesigner WebSocket port
  
  socket.onopen = () => {
    console.log('✅ WebSocket connected successfully');
    clearInterval(reconnectInterval); // Clear reconnection timer if connection succeeds
  };
  
  socket.onerror = (err) => {
    console.error('❌ WebSocket error:', err);
  };
  
  socket.onclose = (event) => {
    console.warn(`⚠️ WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
    // Set up reconnection attempt
    if (!reconnectInterval) {
      console.log('Will attempt to reconnect in 3 seconds...');
      reconnectInterval = setInterval(() => setupWebSocket(), 3000);
    }
  };
}

// Format data for TouchDesigner
function formatDataForTD(detection) {
  // Create a structured data object with all relevant face data
  // TouchDesigner can parse this JSON structure more easily
  return {
    timestamp: Date.now(),
    face: {
      gender: detection.gender,
      genderConfidence: detection.genderProbability,
      age: detection.age,
      position: {
        x: detection.alignedRect.box.x,
        y: detection.alignedRect.box.y,
        width: detection.alignedRect.box.width,
        height: detection.alignedRect.box.height
      },
      expressions: detection.expressions
    }
  };
}

// Send data through WebSocket
function sendData(data) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  
  // Convert data to JSON string
  const jsonData = JSON.stringify(data);
  
  // Only send if data changed - avoids flooding the connection
  if (jsonData !== lastSentData) {
    socket.send(jsonData);
    lastSentData = jsonData;
    return true;
  }
  
  return false;
}

async function setup() {
  // Create video capture
  video = createCapture(VIDEO);
  video.size(720, 560);
  video.hide();
  
  // Create canvas with the same size as the video
  canvas = createCanvas(video.width, video.height);
  canvas.position(0, 0);
  
  console.log('Setting up Face-API.js...');
  
  // Check if faceapi is defined
  if (typeof faceapi === 'undefined') {
    console.error('Error: Face-API.js is not loaded!');
    return;
  }
  
  // Load Face-API models
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('./models'),
      faceapi.nets.faceExpressionNet.loadFromUri('./models'),
      faceapi.nets.ageGenderNet.loadFromUri('./models')
    ]);
    console.log('✅ All Face-API.js models loaded successfully');
  } catch (error) {
    console.error('❌ Error loading Face-API.js models:', error);
    return;
  }
  
  // Initialize WebSocket connection
  setupWebSocket();
  
  // Face detection loop with performance optimization
  setInterval(async () => {
    if (video.elt.readyState === 4) { // Video is ready
      const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,    // Smaller value for better performance
        scoreThreshold: 0.5 // Only detect confident faces
      });
      
      const displaySize = { width: video.width, height: video.height };
      
      try {
        // Detect faces and extract features
        detections = await faceapi.detectAllFaces(video.elt, options)
          .withFaceLandmarks()
          .withFaceExpressions()
          .withAgeAndGender();
          
        // Scale results to canvas size
        detections = faceapi.resizeResults(detections, displaySize);
      } catch (error) {
        console.error('Error in face detection:', error);
      }
    }
  }, 100); // 10 FPS detection rate - adjust as needed for performance
}

function draw() {
  // Draw video on canvas
  image(video, 0, 0, width, height);
  
  // Process detections
  if (detections.length > 0) {
    detections.forEach((detection, index) => {
      if (!detection || !detection.alignedRect) return;
      
      const { x, y, width, height } = detection.alignedRect.box;
      
      // Draw face box
      noFill();
      stroke(0, 255, 0);
      strokeWeight(2);
      rect(x, y, width, height);
      
      // Get gender data
      const gender = detection.gender || "unknown";
      const confidence = detection.genderProbability 
        ? (detection.genderProbability * 100).toFixed(1) 
        : 0;
      
      // Display text
      const textY = y - 10 > 10 ? y - 10 : y + height + 25;
      textSize(16);
      fill(255);
      noStroke();
      text(`Face ${index+1}: ${gender} (${confidence}%)`, x, textY);
      
      // Prepare and send data via WebSocket
      const faceData = formatDataForTD(detection);
      if (sendData(faceData)) {
        console.log(`📤 Sent face ${index+1} data: ${gender} (${confidence}%)`);
      }
    });
  }
  
  // Display connection status
  textSize(14);
  fill(255);
  noStroke();
  let statusMsg = "WebSocket: ";
  if (!socket) {
    statusMsg += "Not initialized";
    fill(255, 165, 0); // Orange
  } else {
    switch (socket.readyState) {
      case WebSocket.CONNECTING:
        statusMsg += "Connecting...";
        fill(255, 255, 0); // Yellow
        break;
      case WebSocket.OPEN:
        statusMsg += "Connected ✓";
        fill(0, 255, 0); // Green
        break;
      case WebSocket.CLOSING:
        statusMsg += "Closing...";
        fill(255, 165, 0); // Orange
        break;
      case WebSocket.CLOSED:
        statusMsg += "Disconnected ✗";
        fill(255, 0, 0); // Red
        break;
    }
  }
  text(statusMsg, 10, height - 10);
}

