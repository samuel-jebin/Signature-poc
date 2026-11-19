import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timer } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';

export interface SignatureRequest {
  status: 'pending' | 'signed';
  signature: string | null; // PNG data URL
}

@Injectable({ providedIn: 'root' })
export class SignatureService {
  private http = inject(HttpClient);

  createRequest() {
    return this.http.post<{ id: string }>('/api/requests', {});
  }
  getRequest(id: string) {
    return this.http.get<SignatureRequest>(`/api/requests/${id}`);
  }
  submit(id: string, pngDataUrl: string) {
    return this.http.post<{ ok: boolean }>(`/api/requests/${id}/signature`, { image: pngDataUrl });
  }
  /** LAN IPs of the machine running the API (used when the app is opened on localhost). */
  networkIps() {
    return this.http.get<{ ips: string[] }>('/api/network');
  }
  /** Polls every 2s and completes right after the first "signed" response. */
  watch(id: string): Observable<SignatureRequest> {
    return timer(0, 2000).pipe(
      switchMap(() => this.getRequest(id)),
      takeWhile((r) => r.status !== 'signed', true),
    );
  }
}
