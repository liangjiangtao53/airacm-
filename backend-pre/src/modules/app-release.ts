import {
  BadRequestException,
  Controller,
  Get,
  Module,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { mkdir, stat, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common';

interface UploadedApk {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
}

interface AppApkStatus {
  url: string;
  path: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
}

const APK_URL = '/downloads/app/airacm-android.apk';
const APK_PATH =
  process.env.APP_APK_PATH ||
  resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'downloads', 'app', 'airacm-android.apk');

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/app')
export class AppReleaseController {
  @Get('apk')
  async apkStatus(): Promise<AppApkStatus> {
    return appApkStatus();
  }

  @Post('apk')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async uploadApk(@CurrentUser() _admin: AuthUser, @UploadedFile() file: UploadedApk): Promise<AppApkStatus> {
    if (!file?.buffer?.length) throw new BadRequestException('请上传 APK 文件');
    if (!file.originalname.toLowerCase().endsWith('.apk')) {
      throw new BadRequestException('只支持上传 .apk 安装包');
    }
    await mkdir(dirname(APK_PATH), { recursive: true });
    await writeFile(APK_PATH, file.buffer);
    return appApkStatus();
  }
}

async function appApkStatus(): Promise<AppApkStatus> {
  try {
    const s = await stat(APK_PATH);
    return {
      url: APK_URL,
      path: APK_PATH,
      exists: true,
      size: s.size,
      updatedAt: s.mtime.toISOString(),
    };
  } catch {
    return { url: APK_URL, path: APK_PATH, exists: false, size: 0, updatedAt: null };
  }
}

@Module({
  controllers: [AppReleaseController],
})
export class AppReleaseModule {}
