import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { LinesService } from './lines.service';
import { ListLineDto } from './dto/list-line.dto';

@Controller('lines')
export class LinesController {
  constructor(private readonly linesService: LinesService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: ListLineDto) {
    return this.linesService.getLines(query);
  }
}
