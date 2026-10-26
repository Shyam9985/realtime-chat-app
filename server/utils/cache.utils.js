
const CACHE_TYPES = Object.freeze({

    // Default - never cache
    NO_STORE: "NO_STORE",

    // Store, but validate before reuse (ETag)
    NO_CACHE: "NO_CACHE",

    // Private browser cache
    PRIVATE_1_MIN: "PRIVATE_1_MIN",
    PRIVATE_5_MIN: "PRIVATE_5_MIN",
    PRIVATE_15_MIN: "PRIVATE_15_MIN",
    PRIVATE_1_HOUR: "PRIVATE_1_HOUR",

    // Shared cache allowed
    PUBLIC_1_MIN: "PUBLIC_1_MIN",
    PUBLIC_5_MIN: "PUBLIC_5_MIN",
    PUBLIC_1_HOUR: "PUBLIC_1_HOUR",
    PUBLIC_1_DAY: "PUBLIC_1_DAY"

});

const applyCacheHeaders = (res, cacheType = CACHE_TYPES.NO_STORE) => {

    switch (cacheType) {

        case CACHE_TYPES.NO_STORE:
            res.set("Cache-Control", "no-store");
            break;

        case CACHE_TYPES.NO_CACHE:
            res.set("Cache-Control", "no-cache");
            break;

        case CACHE_TYPES.PRIVATE_1_MIN:
            res.set("Cache-Control", "private, max-age=60");
            break;

        case CACHE_TYPES.PRIVATE_5_MIN:
            res.set("Cache-Control", "private, max-age=300");
            break;

        case CACHE_TYPES.PRIVATE_15_MIN:
            res.set("Cache-Control", "private, max-age=900");
            break;

        case CACHE_TYPES.PRIVATE_1_HOUR:
            res.set("Cache-Control", "private, max-age=3600");
            break;

        case CACHE_TYPES.PUBLIC_1_MIN:
            res.set("Cache-Control", "public, max-age=60");
            break;

        case CACHE_TYPES.PUBLIC_5_MIN:
            res.set("Cache-Control", "public, max-age=300");
            break;

        case CACHE_TYPES.PUBLIC_1_HOUR:
            res.set("Cache-Control", "public, max-age=3600");
            break;

        case CACHE_TYPES.PUBLIC_1_DAY:
            res.set("Cache-Control", "public, max-age=86400");
            break;

        default:
            res.set("Cache-Control", "no-store");
    }
};

module.exports = {
    applyCacheHeaders, CACHE_TYPES
};