const dbutils = require('../utils/db.utils');
const { log } = require('../utils/log.utils');

const COLUMNS = 'release_id, version, version_code, apk_url, notes, is_mandatory, released_at';

// the newest published release
exports.getLatest = () => {
    log('in getLatest release');
    const qry = `select ${COLUMNS} from app_releases_t where is_active = 1 order by version_code desc limit 1`;
    return dbutils.executeQuery(qry, [], 'latest release');
};

// whether any release newer than this build is mandatory (a skipped mandatory release still counts)
exports.hasMandatoryAfter = async (versionCode) => {
    log('in hasMandatoryAfter');
    const qry = 'select 1 as yes from app_releases_t where is_active = 1 and is_mandatory = 1 and version_code > ? limit 1';
    return (await dbutils.executeQuery(qry, [versionCode], 'mandatory release after')).length > 0;
};

// publishing: a new release row. version and version_code are unique, so a release is published once
exports.insert = ({ version, versionCode, apkUrl, notes, isMandatory }) => {
    log('in insert release');
    const qry = 'insert into app_releases_t (version, version_code, apk_url, notes, is_mandatory) values (?, ?, ?, ?, ?)';
    return dbutils.executeQuery(qry, [version, versionCode, apkUrl, notes || null, isMandatory ? 1 : 0], 'insert release');
};
