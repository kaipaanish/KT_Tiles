import samples from 'virtual:samples';
import { loadPhoto, loadPhotoFromUrl, pickPhotoFile, type Photo } from './capture';
import { PhotoView, type Sample } from './photoView';

export interface PhotoModeHooks {
  /** Something the panels show has changed (a photo arrived, a status changed). */
  changed(): void;
  toast(message: string): void;
}

/**
 * Photo mode's controller: owns the photo in memory and the photo stage, and grows the
 * segmentation, surfaces and compositing as later steps add them.
 */
export class PhotoMode {
  readonly view: PhotoView;
  photo: Photo | null = null;
  readonly samples: readonly Sample[] = samples;

  constructor(
    stage: HTMLElement,
    private readonly hooks: PhotoModeHooks,
  ) {
    this.view = new PhotoView(stage, {
      take: () => void this.take(),
      choose: () => void this.choose(),
      useSample: (sample) => void this.useSample(sample),
    });
  }

  show(visible: boolean): void {
    this.view.setVisible(visible);
  }

  async take(): Promise<void> {
    const file = await pickPhotoFile(true);
    if (file) await this.load(() => loadPhoto(file, file.name || 'Camera photo'));
  }

  async choose(): Promise<void> {
    const file = await pickPhotoFile(false);
    if (file) await this.load(() => loadPhoto(file, file.name || 'Photo'));
  }

  async useSample(sample: Sample): Promise<void> {
    await this.load(() => loadPhotoFromUrl(sample.url, sample.title));
  }

  private async load(read: () => Promise<Photo>): Promise<void> {
    this.view.setBusy('Opening the photo…');
    try {
      this.photo = await read();
      this.view.setPhoto(this.photo);
      this.hooks.changed();
    } catch (error) {
      console.warn('Could not open the photo', error);
      this.hooks.toast("Couldn't open that photo. Please try another one.");
    } finally {
      this.view.setBusy(null);
    }
  }
}
