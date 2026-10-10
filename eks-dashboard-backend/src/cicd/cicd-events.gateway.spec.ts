import { CicdEventsGateway } from './cicd-events.gateway';

const client = () => ({
  id: 'socket-1',
  handshake: { auth: { token: 'jwt-token' } },
  data: {},
  emit: jest.fn(),
  disconnect: jest.fn(),
});

describe('CicdEventsGateway', () => {
  it('authenticates the socket before marking it ready', async () => {
    const runs = {
      actor: jest.fn().mockResolvedValue({ userId: 7, username: 'lemo' }),
    };
    const gateway = new CicdEventsGateway(runs as never);
    const socket = client();

    await gateway.handleConnection(socket as never);

    expect(runs.actor).toHaveBeenCalledWith('Bearer jwt-token');
    expect(socket.data).toEqual({
      authorization: 'Bearer jwt-token',
      userId: 7,
      username: 'lemo',
    });
    expect(socket.emit).toHaveBeenCalledWith('cicd-ready', { connected: true });
  });

  it('rejects unauthenticated sockets', async () => {
    const runs = { actor: jest.fn().mockRejectedValue(new Error('invalid')) };
    const gateway = new CicdEventsGateway(runs as never);
    const socket = client();

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('streams one progressive Jenkins chunk and closes the subscription', async () => {
    const runs = {
      log: jest.fn().mockResolvedValue({ text: 'line\n', nextStart: 5, hasMore: false }),
    };
    const gateway = new CicdEventsGateway(runs as never);
    const socket = client();
    socket.data = { authorization: 'Bearer jwt-token' };
    const runId = '11111111-1111-4111-8111-111111111111';

    await gateway.subscribeLog(socket as never, { runId, start: 0 });

    expect(runs.log).toHaveBeenCalledWith('Bearer jwt-token', runId, 0);
    expect(socket.emit).toHaveBeenCalledWith('cicd-log-chunk', {
      runId,
      text: 'line\n',
      start: 0,
      nextStart: 5,
    });
    expect(socket.emit).toHaveBeenCalledWith('cicd-log-end', { runId, nextStart: 5 });
  });
});
