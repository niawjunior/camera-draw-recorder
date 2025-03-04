import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import RecordRTC from 'recordrtc';
import { Peer } from 'peerjs';

import { openDB } from 'idb';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

const DB_NAME = 'recordingDB';
const STORE_NAME = 'recordingParts';

interface Shape {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  isSelected: boolean;
  isResizing: boolean;
  type: 'square' | 'rectangle' | 'free';
  points?: { x: number; y: number }[]; // For free draw mode
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class AppComponent implements OnInit {
  @ViewChild('remoteVideo', { static: true })
  remoteVideoElement!: ElementRef<HTMLVideoElement>;
  userIdToCall: string = ''; // Input for calling user ID
  isMuted = false; // Mute toggle state
  isRendering = false;
  @ViewChild('video', { static: true })
  videoElement!: ElementRef<HTMLVideoElement>;

  @ViewChild('recordingCanvas', { static: true })
  recordingCanvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('videoCanvas', { static: true })
  videoCanvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawingCanvas', { static: true })
  drawingCanvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewVideo', { static: true })
  previewVideoElement!: ElementRef<HTMLVideoElement>;
  isRecording = false;
  selectedShape: string = 'free'; // Default to free draw
  isPaused = false; // Flag to track whether recording is paused
  recordingParts: Blob[] = []; // Store parts of the recording
  selectedColor: string = '#ff0000'; // Default to red
  private undoStack: Shape[][] = [];
  private redoStack: Shape[][] = [];
  peer!: Peer;
  call!: any;
  agentPeerId: string = '';
  localStream!: MediaStream;
  remoteStream!: MediaStream;
  private audioContext!: AudioContext;
  private remoteAudioSource!: MediaStreamAudioSourceNode;
  private remoteAudioOutput!: MediaStreamAudioDestinationNode;
  private stream!: MediaStream;
  private recorder!: RecordRTC;
  private isDrawing = false;
  private isDragging = false;
  private isResizing = false;
  private selectedShapeIndex: number | null = null;
  private shapes: Shape[] = [];
  private videoContext!: CanvasRenderingContext2D;
  private drawingContext!: CanvasRenderingContext2D;
  private startX = 0;
  private startY = 0;
  async ngOnInit() {
    this.initializeCamera();

    const savedParts = await this.getAllPartsFromDB();

    savedParts.forEach((blob, index) => {
      console.log(`Part ${index}: Size: ${blob.size}, MIME: ${blob.type}`);
    });
    if (savedParts.length > 0) {
      this.recordingParts = savedParts;
      this.isPaused = true; // Set isPaused to true since there is existing data
      console.log('Loaded saved recording parts from previous session.');

      const fullRecording = new Blob(savedParts, { type: 'video/webm' });

      console.log('Combined Blob size:', fullRecording.size);

      // Generate a URL for the combined Blob
      const videoURL = URL.createObjectURL(fullRecording);

      // Set the preview video element
      const previewVideo = this.previewVideoElement.nativeElement;
      previewVideo.src = videoURL;

      // Load and play the video for preview
      previewVideo.load();
      previewVideo.play();
    }
  }

  initializePeer() {
    this.peer = new Peer(); // Generate unique ID for agent

    this.peer.on('open', (id) => {
      console.log('My Peer ID:', id);
      this.agentPeerId = id;
      // Share this ID with the user to start the call
    });

    this.peer.on('call', (call) => {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((stream) => {
          this.localStream = stream;
          call.answer(stream);

          call.on('stream', (remoteStream) => {
            this.remoteStream = remoteStream;

            this.remoteAudioSource =
              this.audioContext.createMediaStreamSource(remoteStream);
            this.remoteAudioOutput =
              this.audioContext.createMediaStreamDestination();
            this.remoteAudioSource.connect(this.audioContext.destination);

            const remoteVideo = this.remoteVideoElement.nativeElement;
            remoteVideo.srcObject = remoteStream;
            remoteVideo.muted = true; // 🔇 Only mute video element, but NOT the stream audio
          });
        });
      this.call = call;
    });
  }
  callUser(userId: string) {
    if (!userId.trim()) {
      console.warn('User ID is required to initiate a call.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        this.localStream = stream;
        this.videoElement.nativeElement.srcObject = stream;

        this.call = this.peer.call(userId, stream);
        this.call.on('stream', (remoteStream: MediaStream) => {
          this.remoteStream = remoteStream;
          // ✅ Route Remote Audio Correctly
          this.remoteAudioSource =
            this.audioContext.createMediaStreamSource(remoteStream);
          this.remoteAudioSource.connect(this.audioContext.destination);

          // ✅ Mute Remote Video to Prevent Feedback
          const remoteVideo = this.remoteVideoElement.nativeElement;
          remoteVideo.srcObject = remoteStream;
          remoteVideo.muted = true; // 🔇 Only mute video, not audio
        });
      });
  }

  endCall() {
    if (this.call) {
      this.call.close();
      this.videoElement.nativeElement.srcObject = null;
      this.remoteVideoElement.nativeElement.srcObject = null;
    }
  }

  updateDrawingColor(event: Event) {
    const colorInput = event.target as HTMLInputElement;
    this.selectedColor = colorInput.value;
    this.drawingContext.strokeStyle = this.selectedColor;
    console.log('Drawing color updated to:', this.selectedColor);
  }

  initializeCamera() {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        this.stream = stream;

        const video = this.videoElement.nativeElement;
        video.srcObject = stream;

        video.onloadedmetadata = () => {
          video.play();

          // Set up video canvas
          const videoCanvas = this.videoCanvasElement.nativeElement;
          videoCanvas.width = video.videoWidth || 640;
          videoCanvas.height = video.videoHeight || 480;
          this.videoContext = videoCanvas.getContext('2d')!;

          // Set up drawing canvas
          const drawingCanvas = this.drawingCanvasElement.nativeElement;
          drawingCanvas.width = video.videoWidth || 640;
          drawingCanvas.height = video.videoHeight || 480;
          this.drawingContext = drawingCanvas.getContext('2d')!;

          this.renderVideoOnCanvas();

          this.initializePeer();
          this.audioContext = new AudioContext();
        };
      })
      .catch((err) => console.error('Error accessing camera:', err));
  }

  renderVideoOnCanvas() {
    const video = this.videoElement.nativeElement;
    const videoCanvas = this.videoCanvasElement.nativeElement;

    const drawFrame = () => {
      this.videoContext.drawImage(
        video,
        0,
        0,
        videoCanvas.width,
        videoCanvas.height
      );
      requestAnimationFrame(drawFrame);
    };

    drawFrame();
  }

  async startRecording() {
    this.isRecording = true;

    const videoCanvas = this.videoCanvasElement.nativeElement;
    const videoContext = videoCanvas.getContext('2d')!;
    const drawingCanvas = this.drawingCanvasElement.nativeElement;
    const drawingContext = drawingCanvas.getContext('2d')!;

    // ✅ Use a separate recording canvas to prevent duplication issues
    const recordingCanvas = this.recordingCanvasElement.nativeElement;
    const recordingContext = recordingCanvas.getContext('2d')!;

    // Ensure both canvases have the same dimensions
    videoCanvas.width = recordingCanvas.width = 640;
    videoCanvas.height = recordingCanvas.height = 480;

    const localVideo = this.videoElement.nativeElement;
    const remoteVideo = this.remoteVideoElement.nativeElement;

    const renderFrame = () => {
      // ✅ CLEAR the recording canvas before drawing
      recordingContext.clearRect(
        0,
        0,
        recordingCanvas.width,
        recordingCanvas.height
      );

      // ✅ Draw Local Video (Full Screen)
      recordingContext.drawImage(
        localVideo,
        0,
        0,
        recordingCanvas.width,
        recordingCanvas.height
      );

      // ✅ Ensure Remote Video is Loaded Before Drawing
      if (remoteVideo.readyState >= 2) {
        const smallVideoWidth = 160;
        const smallVideoHeight = 120;
        recordingContext.drawImage(
          remoteVideo,
          recordingCanvas.width - smallVideoWidth - 10,
          10,
          smallVideoWidth,
          smallVideoHeight
        );
      }

      // ✅ Draw the Drawing Canvas LAST
      recordingContext.drawImage(
        drawingCanvas,
        0,
        0,
        recordingCanvas.width,
        recordingCanvas.height
      );

      requestAnimationFrame(renderFrame);
    };

    // ✅ Prevent multiple render loops
    if (!this.isRendering) {
      this.isRendering = true;
      renderFrame();
    }

    // 🎙️ Capture Mixed Audio
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    let finalStream;
    if (this.localStream && this.remoteStream) {
      const mixedAudioStream = this.audioContext.createMediaStreamDestination();
      const localAudio = this.audioContext.createMediaStreamSource(
        this.localStream
      );
      const remoteAudio = this.audioContext.createMediaStreamSource(
        this.remoteStream
      );

      localAudio.connect(mixedAudioStream);
      remoteAudio.connect(mixedAudioStream);

      finalStream = new MediaStream([
        ...recordingCanvas.captureStream().getVideoTracks(),
        ...mixedAudioStream.stream.getAudioTracks(),
      ]);
    } else {
      finalStream = new MediaStream([
        ...recordingCanvas.captureStream().getVideoTracks(),
        ...micStream.getTracks(),
      ]);
    }

    // 🎥 Start Recording from `recordingCanvas`
    this.recorder = new RecordRTC(finalStream, {
      type: 'video',
      mimeType: 'video/webm;codecs=vp8',
      timeSlice: 3000,
      ondataavailable: async (blob) => {
        if (blob && blob.size > 0) {
          await this.savePartToDB(blob);
        }
      },
    });

    this.recorder.startRecording();
  }

  saveRecordingChunks() {
    const interval = 2000; // Save every 5 seconds

    const saveChunk = async () => {
      if (this.isRecording && this.recorder) {
        // Get the current recording Blob
        const videoBlob = this.recorder.getBlob();
        console.log(videoBlob);

        // Save the chunk to IndexedDB
        await this.savePartToDB(videoBlob);
        console.log('Recording chunk saved to IndexedDB.');
      }

      // Continue saving chunks as long as recording is active
      if (this.isRecording) {
        setTimeout(saveChunk, interval);
      }
    };

    // Start saving chunks
    saveChunk();
  }
  async stopRecording() {
    this.isRecording = false;

    if (this.recorder) {
      this.recorder.stopRecording(async () => {
        console.log('Recording stopped.');

        // Retrieve all parts from IndexedDB
        const allParts = await this.getAllPartsFromDB();

        if (allParts.length === 0) {
          console.error('No valid parts available to combine.');
          return;
        }

        // 📌 Ensure Correct MIME Type
        const isSafari = /^((?!chrome|android).)*safari/i.test(
          navigator.userAgent
        );
        const mimeType = isSafari ? 'video/mp4' : 'video/webm;codecs=vp8';

        const fullRecording = new Blob(allParts, { type: mimeType });

        console.log('Combined Blob size:', fullRecording.size);

        // ✅ Instead of setting a Blob URL (which Safari doesn't support), we download it
        const videoURL = URL.createObjectURL(fullRecording);

        // 🚨 Safari Fix: Force Download Instead of Playing
        if (isSafari) {
          // ✅ Create a MediaStream from the recorded Blob
          const stream = new MediaSource();
          const previewVideo = this.previewVideoElement.nativeElement;
          previewVideo.srcObject = stream; // ✅ Use `srcObject` instead of Blob URL

          stream.addEventListener('sourceopen', async () => {
            const sourceBuffer = stream.addSourceBuffer(mimeType);
            sourceBuffer.appendBuffer(await fullRecording.arrayBuffer());
          });

          previewVideo.load();
          previewVideo.play();
        } else {
          // ✅ Set the preview video element for Chrome/Firefox
          const previewVideo = this.previewVideoElement.nativeElement;
          previewVideo.src = videoURL;
          previewVideo.load();
          previewVideo.play();
        }

        console.log('Preview updated with the combined video.');
      });
    }
  }

  async saveRecording() {
    const allParts = await this.getAllPartsFromDB();

    allParts.forEach((blob, index) => {
      console.log(`Part ${index}: Size: ${blob.size}, MIME: ${blob.type}`);
    });
    // Combine all parts into a single Blob
    const fullRecording = new Blob(allParts, { type: 'video/webm' }); // Adjust MIME type if needed

    console.log('Saved parts in IndexedDB:', allParts);
    console.log('Blob size:', fullRecording.size);

    const downloadURL = URL.createObjectURL(fullRecording);

    const a = document.createElement('a');
    a.href = downloadURL;
    a.download = 'resumable-recording.webm'; // Match the MIME type
    a.click();

    await this.clearDB(); // Clear IndexedDB after saving
    console.log('Recording saved as WebM and IndexedDB cleared.');
  }

  startDrawing(event: MouseEvent) {
    const rect =
      this.drawingCanvasElement.nativeElement.getBoundingClientRect();
    this.startX =
      ((event.clientX - rect.left) / rect.width) *
      this.drawingCanvasElement.nativeElement.width;
    this.startY =
      ((event.clientY - rect.top) / rect.height) *
      this.drawingCanvasElement.nativeElement.height;

    this.saveStateToUndoStack();

    this.selectedShapeIndex = this.findShapeAtPosition(
      this.startX,
      this.startY
    );
    if (this.selectedShapeIndex !== null) {
      this.isDragging = true;
    } else {
      this.isDrawing = true;

      if (
        this.selectedShape === 'square' ||
        this.selectedShape === 'rectangle'
      ) {
        this.shapes.push({
          x: this.startX,
          y: this.startY,
          width: 0,
          height: 0,
          color: this.selectedColor,
          isSelected: true,
          isResizing: false,
          type: this.selectedShape,
        });
      } else {
        this.shapes.push({
          x: this.startX,
          y: this.startY,
          width: 0,
          height: 0,
          color: this.selectedColor,
          isSelected: true,
          isResizing: false,
          type: 'free',
          points: [{ x: this.startX, y: this.startY }],
        });
      }
    }
  }

  draw(event: MouseEvent) {
    if (!this.isDrawing && !this.isDragging) return;

    const rect =
      this.drawingCanvasElement.nativeElement.getBoundingClientRect();
    const currentX =
      ((event.clientX - rect.left) / rect.width) *
      this.drawingCanvasElement.nativeElement.width;
    const currentY =
      ((event.clientY - rect.top) / rect.height) *
      this.drawingCanvasElement.nativeElement.height;

    if (this.isDragging && this.selectedShapeIndex !== null) {
      const shape = this.shapes[this.selectedShapeIndex];
      shape.x += currentX - this.startX;
      shape.y += currentY - this.startY;
      this.startX = currentX;
      this.startY = currentY;
    } else if (this.isDrawing) {
      if (
        this.selectedShape === 'square' ||
        this.selectedShape === 'rectangle'
      ) {
        const shape = this.shapes[this.shapes.length - 1];
        shape.width = Math.abs(currentX - shape.x);
        shape.height =
          this.selectedShape === 'square'
            ? shape.width
            : Math.abs(currentY - shape.y);
      } else {
        this.shapes[this.shapes.length - 1].points!.push({
          x: currentX,
          y: currentY,
        });
      }
    }

    this.redrawCanvas();
  }

  stopDrawing(event: MouseEvent) {
    this.isDrawing = false;
    this.isDragging = false;
  }

  private findShapeAtPosition(x: number, y: number): number | null {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i];
      if (shape.type === 'square' || shape.type === 'rectangle') {
        if (
          x >= shape.x &&
          x <= shape.x + shape.width &&
          y >= shape.y &&
          y <= shape.y + shape.height
        ) {
          return i;
        }
      }
    }
    return null;
  }

  redrawCanvas() {
    this.drawingContext.clearRect(
      0,
      0,
      this.drawingCanvasElement.nativeElement.width,
      this.drawingCanvasElement.nativeElement.height
    );

    for (const shape of this.shapes) {
      this.drawingContext.strokeStyle = shape.color;
      this.drawingContext.lineWidth = 2;

      if (shape.type === 'square' || shape.type === 'rectangle') {
        this.drawingContext.strokeRect(
          shape.x,
          shape.y,
          shape.width,
          shape.height
        );
      } else {
        this.drawingContext.beginPath();
        shape.points!.forEach((point, index) => {
          if (index === 0) {
            this.drawingContext.moveTo(point.x, point.y);
          } else {
            this.drawingContext.lineTo(point.x, point.y);
          }
        });
        this.drawingContext.stroke();
      }
    }
  }

  undo() {
    if (this.shapes.length > 0) {
      this.redoStack.push([...this.shapes]);
      this.shapes.pop();
      this.redrawCanvas();
    }
  }
  /** REDO FUNCTION **/
  /** REDO FUNCTION **/
  redo() {
    if (this.redoStack.length > 0) {
      this.shapes = this.redoStack.pop()!;
      this.redrawCanvas();
    }
  }

  private saveStateToUndoStack() {
    this.undoStack.push([...this.shapes]);
    this.redoStack = []; // Clear redo stack on new action
  }

  /** HANDLE KEY PRESS EVENTS **/
  handleKeyPress(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
      this.undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
      this.redo();
    }
  }

  pauseRecording() {
    this.isPaused = true;
    this.isRecording = false;

    if (this.recorder) {
      this.recorder.pauseRecording();
    }
  }

  resumeRecording() {
    this.isPaused = false;
    this.isRecording = true;

    const videoCanvas = this.videoCanvasElement.nativeElement;
    const drawingCanvas = this.drawingCanvasElement.nativeElement;

    // Create a new canvas to combine video and drawing layers
    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = videoCanvas.width;
    combinedCanvas.height = videoCanvas.height;
    const combinedContext = combinedCanvas.getContext('2d')!;

    // Function to continuously merge the video and drawing layers
    const mergeLayers = () => {
      combinedContext.drawImage(videoCanvas, 0, 0);
      combinedContext.drawImage(drawingCanvas, 0, 0);
      requestAnimationFrame(mergeLayers);
    };
    mergeLayers();

    // Capture the combined canvas stream for the new recorder
    const combinedStream = combinedCanvas.captureStream();
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const mimeType = isSafari
      ? 'video/webm;codecs=h264'
      : 'video/webm;codecs=vp8';
    // Create a new recorder instance and attach the `ondataavailable` handler
    this.recorder = new RecordRTC(combinedStream, {
      type: 'video',
      mimeType,
      timeSlice: 3000, // Capture chunks every second
      ondataavailable: async (blob: Blob) => {
        if (blob && blob.size > 0) {
          console.log('Chunk received after resuming. Blob size:', blob.size);

          // Save each chunk to IndexedDB
          await this.savePartToDB(blob);
        }
      },
    });

    // Start recording again
    console.log('Recorder resumed.');
    this.recorder.startRecording();
  }

  async savePartToDB(part: Blob) {
    if (!part || part.size === 0) {
      console.warn('Attempted to save an invalid or empty Blob.');
      return;
    }

    const db = await openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { autoIncrement: true });
        }
      },
    });

    const key = await db.add(STORE_NAME, part); // Save the part with auto-incremented key
    console.log(
      `Blob saved to IndexedDB with key: ${key}, Blob size: ${part.size}`
    );
  }

  async getAllPartsFromDB(): Promise<Blob[]> {
    const db = await openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { autoIncrement: true });
        }
      },
    });

    const keys = await db.getAllKeys(STORE_NAME); // Ensure all keys are retrieved
    const parts = await Promise.all(keys.map((key) => db.get(STORE_NAME, key)));

    // Filter out invalid or null parts
    const validParts = parts
      .filter((part) => part && part.size > 0)
      .sort((a, b) => a.key - b.key);

    console.log(
      'Retrieved valid parts from IndexedDB:',
      validParts.length,
      validParts
    );
    return validParts as Blob[];
  }

  async clearDB() {
    const db = await openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { autoIncrement: true });
        }
      },
    });
    await db.clear(STORE_NAME);
    window.location.reload();
  }

  toggleMute() {
    if (this.localStream) {
      this.isMuted = !this.isMuted;
      this.localStream
        .getAudioTracks()
        .forEach((track) => (track.enabled = !this.isMuted));
    }
  }
}
