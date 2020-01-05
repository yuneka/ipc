const { IPC } = require(__dirname + '/../index.js');

async function main () {
    ipc = new IPC(process);
    const deferedReady = ipc.once('ready')
    const deferedFinish = ipc.once('finish')

    ipc.on('event', data => {
        console.log('slave event', data)
    })
    ipc.func('log', async data => {
        console.log('slave log', data)
        return data + ' return from slave'
    })
    ipc.func('error', async data => {
        console.log('slave error', data)
        throw new Error(data)
    })

    ipc.emit('ready')
    await deferedReady

    ipc.emit('event', 'qq from slave')
    console.log('slave got', await ipc.rpc.log('slave data ww'))

    ipc.emit('finish')
    await deferedFinish

    ipc.close()
}
main()
