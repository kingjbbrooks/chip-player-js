const chroma = require('chroma-js');

const MODE_LINEAR = 0;
const MODE_LOG = 1;
const MODE_CONSTANT_Q = 2;
const colorMap = new chroma.scale([
  '#000000',
  '#0000a0',
  '#6000a0',
  '#962761',
  '#dd1440',
  '#f0b000',
  '#ffffa0',
  '#ffffff',
]).domain([0, 255]);
const _debug = window.location.search.indexOf('debug=true') !== -1;
let _calcTime = 0;
let _renderTime = 0;
let _timeCount = 0;
let _lastTime = 0;

export default class Spectrogram {
  constructor(chipCore, audioCtx, freqCanvas, specCanvas, minDb = -90, maxDb = -30) {
    this.updateFrame = this.updateFrame.bind(this);
    this.setPaused = this.setPaused.bind(this);

    // Constant Q setup
    this.lib = chipCore;
    const db = 20;
    const supersample = 0;
    const cqtSize = this.lib._cqt_init(audioCtx.sampleRate, freqCanvas.width, 60, db, db, supersample);
    console.log('cqtSize:', cqtSize);
    if (!cqtSize) throw Error('Error initializing constant Q transform.');
    this.cqtSize = cqtSize;
    this.cqtOutput = this.lib.allocate(16, 'float', this.lib.ALLOC_NORMAL);
    this.cqtInput = this.lib.allocate(cqtSize * 4, 'float', this.lib.ALLOC_NORMAL);
    this.floatTimeDomainData = new Float32Array(this.cqtSize);

    this.paused = true;
    this.mode = MODE_LINEAR;

    this.analyserNode = audioCtx.createAnalyser();
    this.analyserNode.minDecibels = minDb;
    this.analyserNode.maxDecibels = maxDb;
    this.analyserNode.smoothingTimeConstant = 0.0;
    this.analyserNode.fftSize = this.fftSize = 2048;

    this.byteFrequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);

    this.freqCanvas = freqCanvas;
    this.specCanvas = specCanvas;
    this.tempCanvas = document.createElement('canvas');
    this.tempCanvas.width = this.specCanvas.width;
    this.tempCanvas.height = this.specCanvas.height;

    this.freqCtx = this.freqCanvas.getContext('2d');
    this.specCtx = this.specCanvas.getContext('2d');
    this.tempCtx = this.tempCanvas.getContext('2d');

    this.updateFrame();
  }

  setPaused(paused) {
    this.paused = paused;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === MODE_CONSTANT_Q) {
      this.analyserNode.fftSize = this.cqtSize;
    } else {
      this.analyserNode.fftSize = this.fftSize;
    }
  }

  setFFTSize(size) {
    this.fftSize = size;
    this.analyserNode.fftSize = size;
  }

  updateFrame() {
    requestAnimationFrame(this.updateFrame);
    if (this.paused) return;

    const _start = performance.now();

    const fqHeight = this.freqCanvas.height;
    const canvasWidth = this.freqCanvas.width;
    const divider = (256.0 / fqHeight);
    const frameHeight = 3;

    const data = this.byteFrequencyData;
    const floatData = this.floatTimeDomainData;
    this.freqCtx.fillStyle = 'black';
    this.freqCtx.fillRect(0, 0, this.freqCanvas.width, this.freqCanvas.height);
    this.tempCtx.drawImage(this.specCanvas, 0, 0, this.specCanvas.width, this.specCanvas.height);

    if (this.mode === MODE_LINEAR) {
      this.analyserNode.getByteFrequencyData(data);
      for (let i = 0; i < data.length && i < canvasWidth; ++i) {
        this.freqCtx.fillStyle = colorMap(data[i]).hex();
        this.freqCtx.fillRect(i, fqHeight - data[i] / divider, 1, data[i] / divider);

        this.specCtx.fillStyle = colorMap(data[i]).hex();
        this.specCtx.fillRect(i, 0, 1, frameHeight);
      }
    } else if (this.mode === MODE_LOG) {
      this.analyserNode.getByteFrequencyData(data);
      const logmax = Math.log(data.length);
      for (let i = 0; i < data.length && i < canvasWidth; i++) {
        const x = Math.floor((Math.log(i) / logmax) * canvasWidth);
        const binWidth = Math.floor((Math.log(i + 1) / logmax) * canvasWidth - x);
        this.freqCtx.fillStyle = colorMap(data[i]).hex();
        this.freqCtx.fillRect(x, fqHeight - data[i] / divider, binWidth, data[i] / divider);
        this.specCtx.fillStyle = colorMap(data[i]).hex();
        this.specCtx.fillRect(x, 0, binWidth, frameHeight);
      }
    } else if (this.mode === MODE_CONSTANT_Q) {
      this.analyserNode.getFloatTimeDomainData(floatData);
      for (let i = 0; i < floatData.length; i++) {
        const byteOffset = 4 * i;
        this.lib.setValue(
          this.cqtInput + byteOffset,
          floatData[i],
          'float'
        );
      }
      this.lib._cqt_calc(this.cqtInput, this.cqtInput);
      this.lib._cqt_render_line(this.cqtOutput);
      // copy output to canvas
      for (let i = 0; i < 1024; i++) {
        const val = Math.floor(this.lib.getValue(this.cqtOutput + i * 4, 'float'));
        const fillStyle = colorMap(val).hex();
        this.specCtx.fillStyle = fillStyle;
        this.specCtx.fillRect(i, 0, 1, frameHeight);
        this.freqCtx.fillStyle = fillStyle;
        this.freqCtx.fillRect(i, fqHeight - val / divider, 1, val / divider);
      }
    }

    const _middle = performance.now();

    // set translate on the canvas
    this.specCtx.translate(0, frameHeight);
    // draw the copied image
    this.specCtx.drawImage(this.tempCanvas,
      0, 0, this.specCanvas.width, this.specCanvas.height,
      0, 0, this.specCanvas.width, this.specCanvas.height);

    // reset the transformation matrix
    this.specCtx.setTransform(1, 0, 0, 1, 0, 0);

    const _end = performance.now();

    if (_debug) {
      _calcTime += _middle - _start;
      _renderTime += _end - _middle;
      _timeCount++;
      if (_timeCount >= 100) {
        console.log(
          (_calcTime / _timeCount).toFixed(2) + "  ms   (calc time)\n" +
          (_renderTime / _timeCount).toFixed(2) + "  ms (render time)\n" +
          ((_calcTime + _renderTime) / _timeCount).toFixed(2) + "  ms  (total time)\n" +
          (1000 * _timeCount / (_start - _lastTime)).toFixed(2) + " fps  (frame rate)\n"
        );
        _calcTime = 0.0;
        _renderTime = 0.0;
        _timeCount = 0;
        _lastTime = _start;
      }
    }
  }
}
