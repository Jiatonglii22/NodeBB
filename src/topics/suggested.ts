
'use strict';

import { LoDashStatic } from "lodash";

import _ from 'lodash';

import db from '../database';
import user from '../user';
import privileges from '../privileges';
import search from '../search';
import { TagObject, TopicObject } from "../types";

export default (Topics) => {
    //added types to params
    Topics.getSuggestedTopics = async function (tid : number, uid : number, start : number, stop : number, cutoff : number = 0) : Promise<[TopicObject]> {
        let tids : number[]; //tids represent list of tid type number 
        tid = parseInt(tid.toString(), 10); 
        cutoff = cutoff === 0 ? cutoff : (cutoff * 2592000000);
        const [tagTids, searchTids] = await Promise.all([
            getTidsWithSameTags(tid, cutoff),
            getSearchTids(tid, uid, cutoff),
        ]);

        tids = _.uniq(tagTids.concat(searchTids));

        let categoryTids = [];
        if (stop !== -1 && tids.length < stop - start + 1) {
            categoryTids = await getCategoryTids(tid, cutoff);
        }
        tids = _.shuffle(_.uniq(tids.concat(categoryTids)));
        tids = await privileges.topics.filterTids('topics:read', tids, uid);

        let topicData = await Topics.getTopicsByTids(tids, uid);
        topicData = topicData.filter((topic : TopicObject) => topic && topic.tid !== tid);
        topicData = await user.blocks.filter(uid, topicData);
        topicData = topicData.slice(start, stop !== -1 ? stop + 1 : undefined)
            .sort((t1 : TopicObject, t2 : TopicObject) => parseInt(t2.timestamp) - parseInt(t1.timestamp));
        return topicData;
    };

    async function getTidsWithSameTags(tid : number, cutoff : number) : Promise<number[]> {
        const tags = await Topics.getTopicTags(tid);
        let tids = cutoff === 0 ?
            await db.getSortedSetRevRange(tags.map((tag : TagObject) => `tag:${tag}:topics`), 0, -1) :
            await db.getSortedSetRevRangeByScore(tags.map((tag : TagObject) => `tag:${tag}:topics`), 0, -1, '+inf', Date.now() - cutoff);
        tids = tids.filter((_tid : number) => _tid !== tid); // remove self
        return _.shuffle(_.uniq(tids)).slice(0, 10).map(Number);
    }

    async function getSearchTids(tid : number, uid : number, cutoff: number) : Promise<number[]> {
        const topicData = await Topics.getTopicFields(tid, ['title', 'cid']);
        const data = await search.search({
            query: topicData.title,
            searchIn: 'titles',
            matchWords: 'any',
            categories: [topicData.cid],
            uid: uid,
            returnIds: true,
            timeRange: cutoff !== 0 ? cutoff / 1000 : 0,
            timeFilter: 'newer',
        });
        data.tids = data.tids.filter((_tid : number) => _tid !== tid); // remove self
        return _.shuffle(data.tids).slice(0, 10).map(Number);
    }

    async function getCategoryTids(tid: number, cutoff: number) : Promise<number[]> {
        const cid = await Topics.getTopicField(tid, 'cid');
        const tids = cutoff === 0 ?
            await db.getSortedSetRevRange(`cid:${cid}:tids:lastposttime`, 0, 9) :
            await db.getSortedSetRevRangeByScore(`cid:${cid}:tids:lastposttime`, 0, 9, '+inf', Date.now() - cutoff);
        return _.shuffle(tids.map(Number).filter((_tid : number) => _tid !== tid));
    }
};
