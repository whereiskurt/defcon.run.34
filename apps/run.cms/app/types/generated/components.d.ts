import type { Schema, Struct } from '@strapi/strapi';

export interface SharedCoordinates extends Struct.ComponentSchema {
  collectionName: 'components_shared_coordinates';
  info: {
    description: 'GPS latitude/longitude pair';
    displayName: 'Coordinates';
    icon: 'map-pin';
  };
  attributes: {
    latitude: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 90;
          min: -90;
        },
        number
      >;
    longitude: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 180;
          min: -180;
        },
        number
      >;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'shared.coordinates': SharedCoordinates;
    }
  }
}
