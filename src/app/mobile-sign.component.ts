import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SignatureService } from './signature.service';
import { SignatureInputComponent } from './signature-input.component';

type State = 'loading' | 'ready' | 'submitting' | 'done' | 'error' | 'invalid';

@Component({
  selector: 'app-mobile-sign',
  standalone: true,
  imports: [SignatureInputComponent],
  template: `
    <div class="screen">
      @switch (state()) {
        @case ('loading') { <p class="msg">Loading…</p> }
        @case ('invalid') { <p class="msg">This signing link is invalid or has expired. Scan a new QR code.</p> }
        @case ('done') { <p class="msg ok">Signature sent. You can close this page.</p> }
        @default {
          <h1>Sign here</h1>
          <app-signature-input (signatureChange)="sig.set($event)" />
          @if (state() === 'error') { <p class="err">Could not send the signature. Check your connection and try again.</p> }
          <button class="submit" [disabled]="!sig() || state() === 'submitting'" (click)="submit()">
            {{ state() === 'submitting' ? 'Sending…' : 'Send signature' }}
          </button>
        }
      }
    </div>
  `,
  styles: [`
    .screen { position: fixed; inset: 0; height: 100dvh; overflow-y: auto; padding: 16px; box-sizing: border-box;
      display: flex; flex-direction: column; gap: 8px; background: #f6f7f9; font-family: system-ui, sans-serif; color: #1b1f2a; }
    h1 { margin: 4px 0 8px; font-size: 22px; }
    .msg { margin: auto; text-align: center; font-size: 18px; } .ok { color: #1a7f37; } .err { color: #b00020; }
    .submit { margin-top: auto; padding: 16px; font-size: 18px; border: 0; border-radius: 8px; background: #0a1f44; color: #fff; }
    .submit:disabled { opacity: .4; }
  `],
})
export class MobileSignComponent {
  private api = inject(SignatureService);
  private id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;

  state = signal<State>('loading');
  sig = signal<string | null>(null);

  constructor() {
    this.api.getRequest(this.id).subscribe({
      next: (r) => this.state.set(r.status === 'signed' ? 'done' : 'ready'),
      error: () => this.state.set('invalid'),
    });
  }

  submit() {
    const png = this.sig();
    if (!png) return;
    this.state.set('submitting');
    this.api.submit(this.id, png).subscribe({
      next: () => this.state.set('done'),
      error: () => this.state.set('error'),
    });
  }
}
