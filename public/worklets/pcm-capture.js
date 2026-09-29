// Live Voice Mode mic capture. Runs on the audio rendering thread (not the
// main thread, unlike the deprecated ScriptProcessorNode), so React renders
// can't glitch the stream. Batches 640 samples (40ms @ 16kHz) of Float32 into
// PCM16 LE and transfers the buffer to the main thread with the frame's RMS.
const FRAME = 640;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(FRAME);
    this.len = 0;
    this.sq = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.sq += s * s;
      this.buf[this.len++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.len === FRAME) {
        this.port.postMessage({ pcm: this.buf.buffer, rms: Math.sqrt(this.sq / FRAME) }, [this.buf.buffer]);
        this.buf = new Int16Array(FRAME);
        this.len = 0;
        this.sq = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
