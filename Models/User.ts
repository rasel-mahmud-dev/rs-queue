import {
    Column,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
} from "typeorm"

import {Tweet} from "./Tweet";

@Entity("users")
export class User {
    @PrimaryGeneratedColumn()
    id!: number

    @Column({unique: true, type: "varchar", nullable: false})
    email!: string

    @Column({type: "varchar", nullable: false})
    firstName!: string

    @Column({type: "varchar", nullable: false})
    lastName!: string

    // @OneToMany(() => Tweet, (tweet) => tweet.author)
    // tweets: Tweet[] | undefined
}