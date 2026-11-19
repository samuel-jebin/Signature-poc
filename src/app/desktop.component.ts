import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import QRCode from 'qrcode';
import { SignatureService } from './signature.service';
import { SignatureInputComponent } from './signature-input.component';

@Component({
  selector: 'app-desktop',
  standalone: true,
  imports: [SignatureInputComponent],
  template: `
    <main>
      <h1>Your signature</h1>

      @if (source() === 'mobile' && final()) {
        <div class="stage readonly">
          <img [src]="final()!" alt="Signature from phone" />
        </div>
        <div class="actions"><button (click)="resetMobile()">Clear</button></div>
      } @else {
        <app-signature-input (signatureChange)="onLocal($event)" />
      }

      <p class="qr-link">
        Prefer your phone?
        <a href="#" (click)="$event.preventDefault(); startQr()">Sign on your phone with a QR code</a>
      </p>

      @if (qr()) {
        <section class="qr">
          <img [src]="qr()!" alt="QR code to sign on your phone" width="200" height="200" />
          <div>
            <p>Scan with your phone camera.</p>
            <p class="status">Waiting for your phone…</p>
            @if (ips().length > 1) {
              <label class="ipsel">Network
                <select (change)="onIp($event)">
                  @for (ip of ips(); track ip) { <option [value]="ip" [selected]="ip === selectedIp()">{{ ip }}</option> }
                </select>
              </label>
            }
            <small>{{ url() }}</small>
          </div>
        </section>
      }

      @if (final()) {
        <div class="dl">
          <button (click)="downloadTransparent()">Download PNG (transparent)</button>
          <button (click)="downloadWhite()">Download with white background</button>
        </div>
      }
    </main>
  `,
  styles: [`
    main { max-width: 560px; margin: 32px auto; padding: 0 16px; font-family: system-ui, sans-serif; color: #1b1f2a; }
    .qr-link { margin: 4px 0 16px; }
    .qr { display: flex; gap: 16px; align-items: center; border: 1px solid #c9cdd6; border-radius: 8px; padding: 16px; }
    .qr small { word-break: break-all; color: #666; }
    .ipsel { display: block; margin: 6px 0; font-size: 13px; } .ipsel select { margin-left: 6px; }
    .status { font-weight: 600; }
    .stage.readonly { height: 220px; border: 1.5px solid #c9cdd6; border-radius: 8px; background: #fff; display: grid; place-items: center; }
    .stage.readonly img { max-width: 100%; max-height: 100%; pointer-events: none; user-select: none; }
    .actions { margin: 10px 0; }
    .actions button { font: inherit; padding: 10px 16px; border-radius: 6px; border: 1px solid #c9cdd6; background: #fff; cursor: pointer; }
    .dl { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .dl button { font: inherit; padding: 10px 16px; border-radius: 6px; border: 1px solid #c9cdd6; background: #fff; cursor: pointer; }
  `],
})
export class DesktopComponent implements OnDestroy {
  private api = inject(SignatureService);
  private sub?: Subscription;
  private reqId = '';

  qr = signal<string | null>(null);
  url = signal('');
  ips = signal<string[]>([]);
  selectedIp = signal<string | null>(null);
  final = signal<string | null>(null);
  source = signal<'local' | 'mobile'>('local');

  onLocal(png: string | null) {
    this.source.set('local');
    this.final.set(png);
  }

  /** Clears the received signature; the QR code stays active for the next scan. */
  resetMobile() {
    this.source.set('local');
    this.final.set(null);
  }

  async startQr() {
    this.sub?.unsubscribe();
    const { id } = await firstValueFrom(this.api.createRequest());
    this.reqId = id;

    // A phone can't reach "localhost", so swap in this machine's LAN IP.
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (isLocal) {
      try {
        const { ips } = await firstValueFrom(this.api.networkIps());
        this.ips.set(ips);
        this.selectedIp.set(ips[0] ?? null);
      } catch { /* fall back to current host */ }
    }
    await this.buildQr();

    this.sub = this.api.watch(id).subscribe((r) => {
      if (r.status === 'signed' && r.signature) {
        this.source.set('mobile');
        this.final.set(r.signature);
        // Generate a fresh QR code for the next upload
        setTimeout(() => this.startQr());
      }
    });
  }

  onIp(e: Event) {
    this.selectedIp.set((e.target as HTMLSelectElement).value);
    this.buildQr();
  }

  private async buildQr() {
    const host = this.selectedIp() ?? location.hostname;
    const port = location.port ? `:${location.port}` : '';
    const url = `${location.protocol}//${host}${port}/sign/${this.reqId}`;
    this.url.set(url);
    this.qr.set(await QRCode.toDataURL(url, { width: 400, margin: 1 }));
  }

  downloadTransparent() {
    const png = this.final();
    if (png) this.save(png, 'signature-transparent.png');
  }

  async downloadWhite() {
    const png = this.final();
    if (!png) return;
    const img = new Image();
    img.src = png;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    this.save(c.toDataURL('image/png'), 'signature-white.png');
  }

  private save(href: string, name: string) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }
}