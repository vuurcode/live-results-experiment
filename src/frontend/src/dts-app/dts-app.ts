import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DtsSignComponent } from '../app/dts/sign/sign.component';

/** The signers' application under /dts/: the sign page and nothing else. */
@Component({
  selector: 'app-dts-root',
  imports: [DtsSignComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-dts-sign />',
})
export class DtsApp {}
