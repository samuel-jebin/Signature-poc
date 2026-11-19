import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, signal } from '@angular/core';
import SignaturePad from 'signature_pad';
import { cleanupSignature } from './image-cleanup';

/** Draw or upload -> emits a trimmed transparent PNG data URL (or null). */
@Component({
  selector: 'app-signature-input',
  standalone: true,
  template: `
    @if (allowUpload) {
      <div class="tabs" role="tablist">
        <button role="tab" [attr.aria-selected]="mode() === 'draw'" (click)="setMode('draw')">Draw</button>
        <button role="tab" [attr.aria-selected]="mode() === 'upload'" (click)="setMode('upload')">Upload image</button>
      </div>
    }

    <div class="stage" [hidden]="mode() !== 'draw'">
      <canvas #canvas></canvas>
      <span class="hint">Sign here</span>
    </div>

    @if (mode() === 'upload') {
      <div class="stage upload">
        <input #file type="file" accept="image/*" hidden (change)="onFile($event)" />
        <div class="pick">
          <button class="primary" (click)="file.click()">{{ hasImage() ? 'Replace image' : 'Choose signature image' }}</button>
          <small>A photo or scan of your signature on white paper.</small>
        </div>
      </div>
      @if (hasImage()) {
        <label class="tune">
          <span>Less ink</span>
          <input type="range" min="-40" max="40" step="2" [value]="sens" (change)="onSens($event)" />
          <span>More ink</span>
        </label>
      }
      @if (error()) { <p class="err">{{ error() }}</p> }
    }

    <div class="actions">
      <button (click)="clear()">Clear</button>
    </div>

        @if (preview() && mode() === 'upload') {
      <p class="label">Preview</p>
      <div class="paper"><img [src]="preview()!" alt="Your signature" /></div>
    }
  `,
  styles: [`
    :host { display: block; }
    .tabs { display: flex; gap: 8px; margin-bottom: 12px; }
    .tabs button { flex: 1; padding: 10px; border: 1px solid #c9cdd6; background: #fff; border-radius: 6px; font: inherit; }
    .tabs button[aria-selected=true] { background: #0a1f44; color: #fff; border-color: #0a1f44; }
        .stage { position: relative; height: 220px; border: 1.5px dashed #8a93a6; border-radius: 8px; background: #fff; overflow: hidden; }
    .stage.upload { display: grid; place-items: center; text-align: center; }
    .pick { display: grid; gap: 8px; justify-items: center; padding: 0 12px; }
    .pick small { color: #666; }
    .hint { position: absolute; left: 12px; bottom: 8px; font-size: 12px; color: #8a93a6; pointer-events: none; }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
    .tune { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: #555; }
    .tune input { flex: 1; }
    .actions { display: flex; gap: 8px; margin: 10px 0; }
    button { font: inherit; padding: 10px 16px; border-radius: 6px; border: 1px solid #c9cdd6; background: #fff; cursor: pointer; }
    button.primary { background: #0a1f44; color: #fff; border-color: #0a1f44; }
    .label { margin: 8px 0 4px; font-size: 13px; color: #555; }
    .paper { border: 1px solid #c9cdd6; border-radius: 8px; padding: 12px; text-align: center; background: #fff; }
    .paper img { max-width: 100%; max-height: 140px; }
    .err { color: #b00020; }
    @media (max-height: 600px) { .stage { height: 150px; } }
  `],
})
export class SignatureInputComponent implements AfterViewInit, OnDestroy {
  @Input() allowUpload = true;
  @Output() signatureChange = new EventEmitter<string | null>();
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  mode = signal<'draw' | 'upload'>('draw');
  preview = signal<string | null>(null);
  error = signal<string | null>(null);
  hasImage = signal(false);
  sens = 0;
  private bitmap: ImageBitmap | null = null;
  private pad!: SignaturePad;
  private onResize = () => this.resizeCanvas();

  ngAfterViewInit() {
    this.pad = new SignaturePad(this.canvasRef.nativeElement, { penColor: '#0a1f44', minWidth: 0.8, maxWidth: 2.6 });
    this.pad.addEventListener('endStroke', () => this.fromPad());
    this.resizeCanvas();
    window.addEventListener('resize', this.onResize);
  }
  ngOnDestroy() { window.removeEventListener('resize', this.onResize); this.pad?.off(); }

  setMode(m: 'draw' | 'upload') {
    this.mode.set(m);
    this.clear();
    if (m === 'draw') setTimeout(() => this.resizeCanvas());
  }

  clear() {
    this.pad.clear();
    this.bitmap = null;
    this.hasImage.set(false);
    this.sens = 0;
    this.error.set(null);
    this.setPreview(null);
  }

  private fromPad() {
    if (this.pad.isEmpty()) return this.setPreview(null);
    const c = this.canvasRef.nativeElement;
    this.setPreview(cleanupSignature(c, c.width, c.height, { hasAlpha: true }));
  }

  async onFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      this.bitmap = await createImageBitmap(f);
      this.hasImage.set(true);
      this.sens = 0;
      this.runUpload();
    } catch {
      this.error.set('That file could not be read as an image.');
      this.setPreview(null);
    }
  }

  onSens(ev: Event) {
    this.sens = +(ev.target as HTMLInputElement).value;
    this.runUpload();
  }

  private runUpload() {
    const b = this.bitmap;
    if (!b) return;
    const png = cleanupSignature(b, b.width, b.height, { hasAlpha: false, sensitivity: this.sens });
    this.error.set(png ? null : 'No signature found. Move the slider toward "More ink" or use a clearer photo.');
    this.setPreview(png);
  }

  private setPreview(v: string | null) {
    this.preview.set(v);
    this.signatureChange.emit(v);
  }

  private resizeCanvas() {
    const c = this.canvasRef.nativeElement;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    if (!c.offsetWidth) return;
    const data = this.pad?.toData();
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    c.getContext('2d')!.scale(ratio, ratio);
    this.pad?.clear();
    if (data?.length) this.pad.fromData(data);
  }
}
