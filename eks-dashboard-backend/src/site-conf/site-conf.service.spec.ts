import { serializeSiteConfValidationJson } from './site-conf.service';

describe('SiteConfService', () => {
  it('serializes MySQL JSON validation rules for the API response', () => {
    expect(serializeSiteConfValidationJson({ min: 1, max: 168 })).toBe(
      '{"min":1,"max":168}',
    );
    expect(serializeSiteConfValidationJson('{"min":1}')).toBe('{"min":1}');
  });
});
