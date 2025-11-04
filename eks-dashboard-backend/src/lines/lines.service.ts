import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ListLineDto } from './dto/list-line.dto';

@Injectable()
export class LinesService {
  private readonly vlinkApiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Make VLINK_API_URL optional at boot; validate when endpoint is called.
    const url = this.configService.get<string>('VLINK_API_URL');
    this.vlinkApiUrl = url || '';
  }

  async getLines(query: ListLineDto) {
    if (!this.vlinkApiUrl) {
      throw new Error('VLINK_API_URL is not configured in environment variables');
    }
    const { lineUrl = '', page, size, tenantId } = query;
    const url = `${this.vlinkApiUrl}/admin/app/line/url/list`;

    // Here you might need to add authentication headers required by the target API
    // For example: const headers = { 'Authorization': 'Bearer YOUR_TOKEN' };
    const headers = {};

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          params: { lineUrl, page, size, tenantId },
          headers,
        }),
      );
      return response.data;
    } catch (error) {
      // It's good practice to log the error and maybe throw a more specific exception
      console.error('Error fetching lines from VLINK API:', error);
      throw new Error('Failed to fetch lines.');
    }
  }
}
