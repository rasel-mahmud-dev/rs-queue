import {Pool, PoolClient} from "pg";

const pool = new Pool({
    user: "postgres",
    host: "postgres",
    database: "rs_queue",
    password: "123",
    port: 5432,
});

let _client: Promise<PoolClient>;

export function dbClient(){
    if(_client) return _client;
    _client = pool.connect()
    return _client
}


export function isConnected(){
    return new Promise((resolve)=>{
        pool.connect((err, client, release) => {
            if (err) {
                resolve(false)
                console.error('Error acquiring client', err.stack);
                return;
            }
            release(); // Release the client back to the pool
            resolve(true)
            console.log('Connection acquired');
        });
    })
}


export default pool;