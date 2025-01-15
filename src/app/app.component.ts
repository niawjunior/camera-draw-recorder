import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import RecordRTC from 'recordrtc';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: true,
})
export class AppComponent implements OnInit {
  @ViewChild('video', { static: true })
  videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('videoCanvas', { static: true })
  videoCanvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawingCanvas', { static: true })
  drawingCanvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewVideo', { static: true })
  previewVideoElement!: ElementRef<HTMLVideoElement>;
  isRecording = false;
  private stream!: MediaStream;
  private recorder!: RecordRTC;
  private isDrawing = false;
  private videoContext!: CanvasRenderingContext2D;
  private drawingContext!: CanvasRenderingContext2D;

  ngOnInit() {
    this.initializeCamera();
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

  startRecording() {
    this.isRecording = true;
    const videoCanvas = this.videoCanvasElement.nativeElement;
    const drawingCanvas = this.drawingCanvasElement.nativeElement;

    // Combine video and drawing layers
    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = videoCanvas.width;
    combinedCanvas.height = videoCanvas.height;
    const combinedContext = combinedCanvas.getContext('2d')!;

    // Merge video and drawing layers during recording
    const mergeLayers = () => {
      combinedContext.drawImage(videoCanvas, 0, 0);
      combinedContext.drawImage(drawingCanvas, 0, 0);
      requestAnimationFrame(mergeLayers);
    };
    mergeLayers();

    // Capture combined canvas stream for recording
    const combinedStream = combinedCanvas.captureStream();
    this.recorder = new RecordRTC(combinedStream, { type: 'video' });
    this.recorder.startRecording();
  }

  stopRecording() {
    this.isRecording = false;
    if (this.recorder) {
      this.recorder.stopRecording(() => {
        const videoBlob = this.recorder.getBlob();
        const videoURL = URL.createObjectURL(videoBlob);

        // Set the preview video source
        const previewVideo = this.previewVideoElement.nativeElement;
        previewVideo.src = videoURL;

        // Stop the camera stream
        // this.stream.getTracks().forEach((track) => track.stop());
      });
    }
  }

  saveRecording() {
    if (this.recorder) {
      this.recorder.save('recorded-video.mp4');
    }
  }

  startDrawing(event: MouseEvent) {
    this.isDrawing = true;

    const rect =
      this.drawingCanvasElement.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    this.drawingContext.beginPath();
    this.drawingContext.moveTo(x, y);
  }

  draw(event: MouseEvent) {
    if (!this.isDrawing) return;

    const rect =
      this.drawingCanvasElement.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    this.drawingContext.lineTo(x, y);
    this.drawingContext.strokeStyle = 'red';
    this.drawingContext.lineWidth = 2;
    this.drawingContext.stroke();
  }

  stopDrawing() {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.drawingContext.closePath();
    }
  }
}
