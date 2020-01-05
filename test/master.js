const { fork } = require('child_process');
const { IPC } = require(__dirname + '/../index.js');

async function main () {
    slave = fork(__dirname + '/slave')
    ipc = new IPC(slave)

    const deferedReady = ipc.once('ready')
    const deferedFinish = ipc.once('finish')
    ipc.on('event', data => console.log('master event', data))
    ipc.rpc.log = data => {
        console.log('master log', data)
        return data + ' return from master'
    }

    ipc.emit('ready')
    await deferedReady

    ipc.emit('event', 'zz from master')
    console.log('master got', await ipc.rpc.log('master data aa'))
    try {
        console.log('master got', await ipc.rpc.error('errormsg'))
    } catch (e) {
        console.log('master got error: ', e)
    }

    ipc.emit('finish')
    await deferedFinish

    ipc.close()
}
main()
