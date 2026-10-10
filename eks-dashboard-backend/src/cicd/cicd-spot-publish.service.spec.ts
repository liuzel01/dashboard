import { parseSpotPublishCatalog } from './cicd-spot-publish.service';

describe('spot publish catalog parser', () => {
  it('extracts controlled services and skips placeholders', () => {
    const html = `<input name="registry" value="registry.example.com" />
      <table><tbody>
        <tr><td>service-a</td><td>ssh://git/repo-a.git</td><td></td><td></td><td><input type="text" value="icoin" /></td></tr>
        <tr><td>_</td><td>ssh://git/placeholder.git</td><td></td><td></td><td><input type="text" value="icoin" /></td></tr>
      </tbody></table>`;
    expect(parseSpotPublishCatalog(html)).toEqual([
      {
        name: 'service-a',
        repo: 'ssh://git/repo-a.git',
        defaultRef: 'icoin',
        registries: ['registry.example.com'],
      },
    ]);
  });
});
